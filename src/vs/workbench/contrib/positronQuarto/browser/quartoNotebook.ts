/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ISingleEditOperation } from '../../../../editor/common/core/editOperation.js';
import { ScrollType } from '../../../../editor/common/editorCommon.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotebookCellDTO, INotebookCellOutputDTO, INotebookContextDTO, NotebookCellType } from '../../../common/positron/notebookAssistant.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { collectOutputDTOs } from '../../positronNotebook/browser/notebookAgentOperations.js';
import { isImageMimeType } from '../../positronNotebook/browser/notebookMimeUtils.js';
import { POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY } from '../../positronNotebook/common/positronNotebookConfig.js';
import { isQuartoDocument, usingQuartoInlineOutput } from '../common/positronQuartoConfig.js';
import { CellExecutionState, IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../common/quartoTypes.js';
import { computeDeleteCellEdit, computeInsertCellEdit, computeReplaceCellCodeEdit } from './quartoCellOperations.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { IQuartoOutputManager } from './quartoOutputManager.js';

/** Removes trailing line breaks, which the cell boundaries supply. */
function trimTrailingNewlines(content: string): string {
	return content.replace(/(\r?\n)+$/, '');
}

/**
 * Finds the Quarto documents that the `positron.notebooks` API can operate on:
 * those open in Positron while inline output is enabled.
 */
export class QuartoNotebooks {
	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IModelService private readonly _modelService: IModelService,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
	) { }

	/** The Quarto document at `uri` as a notebook, if it can be used as one. */
	get(uri: URI): QuartoNotebook | undefined {
		if (!usingQuartoInlineOutput(this._configurationService)) {
			return undefined;
		}
		const textModel = this._modelService.getModel(uri);
		if (!textModel || !isQuartoDocument(uri.path, textModel.getLanguageId())) {
			return undefined;
		}
		return this._instantiationService.createInstance(
			QuartoNotebook, textModel, this._documentModelService.getModel(textModel));
	}

	/** The Quarto document in the active editor as a notebook, if it can be used as one. */
	getActive(): QuartoNotebook | undefined {
		const control = this._editorService.activeTextEditorControl;
		const uri = isCodeEditor(control) ? control.getModel()?.uri : undefined;
		return uri ? this.get(uri) : undefined;
	}
}

/**
 * A Quarto document presented as a notebook whose cells are its code chunks.
 * Edits are applied to the document's text; runs and outputs use the
 * document's inline output kernel.
 */
export class QuartoNotebook {
	constructor(
		private readonly _textModel: ITextModel,
		private readonly _documentModel: IQuartoDocumentModel,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
		@IQuartoOutputManager private readonly _outputManager: IQuartoOutputManager,
	) { }

	get uri(): URI {
		return this._textModel.uri;
	}

	getContext(): INotebookContextDTO {
		const cells = this.getCells();
		const session = this._kernelManager.getSessionForDocument(this.uri);
		return {
			uri: this.uri.toString(),
			kernelId: session?.runtimeMetadata.runtimeId,
			kernelLanguage: session?.runtimeMetadata.languageId ?? this._documentModel.primaryLanguage,
			cellCount: cells.length,
			selectedCells: cells.filter(cell => cell.selectionStatus === 'active'),
			allCells: cells,
			runtimeState: session?.getRuntimeState(),
		};
	}

	getCells(): INotebookCellDTO[] {
		const activeLine = this._activeEditor()?.getPosition()?.lineNumber;
		const activeCell = activeLine === undefined ? undefined : this._documentModel.getCellAtLine(activeLine);
		return this._cells().map(cell => this._toDTO(cell, cell === activeCell));
	}

	getCell(index: number): INotebookCellDTO | undefined {
		return this.getCells()[index];
	}

	async runCells(indices: readonly number[]): Promise<void> {
		const cells = this._cells();
		const toRun = indices.map(index => cells[index]).filter(cell => cell !== undefined);
		if (toRun.length === 0) {
			throw new Error(`No cells found with indices: ${indices.join(', ')}`);
		}
		await this._executionManager.executeCells(this.uri, toRun);
	}

	/** Adds a code chunk in the document's primary language, returning its index. */
	addCell(type: NotebookCellType, index: number, content: string): number {
		if (type !== NotebookCellType.Code) {
			throw new Error('The cells of a Quarto document are its code chunks. Edit the text between them with the text tools.');
		}
		const language = this._documentModel.primaryLanguage;
		if (!language) {
			throw new Error('Cannot add a code chunk: the document has no primary language.');
		}
		const cells = this._cells();
		const insertIndex = Math.max(0, Math.min(index, cells.length));
		const insertLine = insertIndex < cells.length ? cells[insertIndex].startLine : this._textModel.getLineCount() + 1;
		const { edits } = computeInsertCellEdit(this._textModel, language, insertLine, trimTrailingNewlines(content));
		this._applyEdits(() => edits);
		return insertIndex;
	}

	/** Deletes cells, along with a blank line that follows each. */
	deleteCells(indices: readonly number[]): void {
		const cells = this._cells();
		for (const index of indices) {
			this._checkIndex(index, cells);
		}
		// Delete from the bottom up, re-reading each cell after the previous
		// edit, since a deletion can reach into the line above it.
		const descending = [...new Set(indices)].sort((a, b) => b - a);
		this._applyEdits(...descending.map(index => () => computeDeleteCellEdit(this._textModel, this._cells()[index])));
	}

	updateCellContent(index: number, content: string): void {
		const cells = this._cells();
		this._checkIndex(index, cells);
		this._applyEdits(() => computeReplaceCellCodeEdit(this._textModel, cells[index], trimTrailingNewlines(content)));
	}

	async getCellOutputs(index: number): Promise<INotebookCellOutputDTO[]> {
		const cells = this._cells();
		this._checkIndex(index, cells);
		// Image data is base64-encoded; everything else is text.
		const outputs = this._outputManager.getOutputsForCell(this.uri, cells[index]).map(output =>
			output.items.map(item => ({
				mime: item.mime,
				data: isImageMimeType(item.mime) ? decodeBase64(item.data) : VSBuffer.fromString(item.data),
			})));
		return collectOutputDTOs(outputs, this._logService, { textOnly: false });
	}

	/** Reveals a cell in the active editor, unless assistant auto-follow is off. */
	scrollToCellIfNeeded(index: number): void {
		const cell = this._cells()[index];
		const autoFollow = this._configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ASSISTANT_AUTO_FOLLOW_KEY) ?? true;
		if (cell && autoFollow) {
			this._activeEditor()?.revealLinesInCenterIfOutsideViewport(cell.startLine, cell.endLine, ScrollType.Smooth);
		}
	}

	/** Clears the outputs of the given cells, or of all cells. */
	clearCellOutputs(indices?: readonly number[]): void {
		if (indices === undefined) {
			this._outputManager.clearAllOutputs(this.uri);
			return;
		}
		const cells = this._cells();
		for (const index of indices) {
			this._checkIndex(index, cells);
		}
		for (const index of indices) {
			this._outputManager.clearOutputsForCell(this.uri, cells[index].id);
		}
	}

	/** The document's code chunks, reflecting its current content. */
	private _cells(): readonly QuartoCodeCell[] {
		this._documentModel.synchronize();
		return this._documentModel.cells;
	}

	private _toDTO(cell: QuartoCodeCell, isActive: boolean): INotebookCellDTO {
		const state = this._executionManager.getExecutionState(cell.id);
		return {
			id: cell.id,
			index: cell.index,
			type: NotebookCellType.Code,
			content: this._documentModel.getCellCode(cell),
			hasOutput: this._outputManager.getOutputsForCell(this.uri, cell).length > 0,
			selectionStatus: isActive ? 'active' : 'unselected',
			executionStatus: state === CellExecutionState.Running ? 'running'
				: state === CellExecutionState.Queued ? 'pending'
					: 'idle',
			lastRunSuccess: state === CellExecutionState.Completed ? true
				: state === CellExecutionState.Error ? false
					: undefined,
		};
	}

	private _checkIndex(index: number, cells: readonly QuartoCodeCell[]): void {
		if (!Number.isInteger(index) || index < 0 || index >= cells.length) {
			throw new Error(`Cell not found at index: ${index}`);
		}
	}

	/**
	 * Applies edits as a single undoable step. Each function computes its
	 * edits after the previous ones are applied.
	 */
	private _applyEdits(...computeEdits: (() => ISingleEditOperation[])[]): void {
		this._textModel.pushStackElement();
		for (const compute of computeEdits) {
			this._textModel.pushEditOperations(null, compute(), () => null);
		}
		this._textModel.pushStackElement();
	}

	/** The active editor, if it shows this document. */
	private _activeEditor(): ICodeEditor | undefined {
		const control = this._editorService.activeTextEditorControl;
		return isCodeEditor(control) && control.getModel() === this._textModel ? control : undefined;
	}
}
