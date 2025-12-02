/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { MainPositronContext, MainThreadNotebookFeaturesShape, INotebookContextDTO, INotebookCellDTO, INotebookCellOutputDTO } from '../../common/positron/extHost.positron.protocol.js';
import { NotebookCellType } from '../../common/positron/extHostTypes.positron.js';
import { IPositronNotebookService } from '../../../contrib/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookInstance, NotebookOperationType } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell, CellSelectionStatus, IPositronNotebookCodeCell } from '../../../contrib/positronNotebook/browser/PositronNotebookCells/IPositronNotebookCell.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane } from '../../../contrib/positronNotebook/browser/notebookUtils.js';
import { CellSelectionType, getSelectedCells } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { URI } from '../../../../base/common/uri.js';
import { CellKind, CellEditType } from '../../../contrib/notebook/common/notebookCommon.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { encodeBase64 } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { isImageMimeType, isTextBasedMimeType } from '../../../contrib/positronNotebook/browser/notebookMimeUtils.js';

/**
 * Main thread implementation of notebook features for extension host communication.
 * Provides methods for interacting with Positron notebooks from extensions.
 */
@extHostNamedCustomer(MainPositronContext.MainThreadNotebookFeatures)
export class MainThreadNotebookFeatures implements MainThreadNotebookFeaturesShape {
	private readonly _disposables = new DisposableStore();

	constructor(
		_extHostContext: IExtHostContext,
		@IEditorService private readonly _editorService: IEditorService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService,
		@ILogService private readonly _logService: ILogService,
	) {
		// No initialization needed
	}

	/**
	 * Helper function to map a cell to DTO
	 * @param cell The cell to map
	 * @returns The cell DTO with status information
	 */
	private mapCellToDTO(cell: IPositronNotebookCell): INotebookCellDTO {
		const cellId = cell.uri.toString();
		const isCodeCell = cell.isCodeCell();
		const cellOutputs = isCodeCell ? cell.outputs.get() : [];

		// Map selection status: 'editing' -> 'active', others map directly
		const rawSelectionStatus = cell.selectionStatus.get();
		const selectionStatus = rawSelectionStatus === CellSelectionStatus.Editing
			? 'active'
			: rawSelectionStatus === CellSelectionStatus.Selected
				? 'selected'
				: 'unselected';

		const baseDTO: INotebookCellDTO = {
			id: cellId,
			index: cell.index,
			type: cell.kind === CellKind.Code ? NotebookCellType.Code : NotebookCellType.Markdown,
			content: cell.getContent(),
			hasOutput: cellOutputs.length > 0,
			selectionStatus
		};

		// Add execution-related fields only for code cells
		if (isCodeCell) {
			const codeCell = cell as IPositronNotebookCodeCell;
			baseDTO.executionStatus = codeCell.executionStatus.get();
			baseDTO.executionOrder = codeCell.lastExecutionOrder.get();
			baseDTO.lastRunSuccess = codeCell.lastRunSuccess.get();
			baseDTO.lastExecutionDuration = codeCell.lastExecutionDuration.get();
			baseDTO.lastRunEndTime = codeCell.lastRunEndTime.get();
		}

		return baseDTO;
	}

	/**
	 * Gets the context information for the currently active notebook.
	 * @returns The notebook context DTO, or undefined if no notebook is active.
	 */
	async $getActiveNotebookContext(): Promise<INotebookContextDTO | undefined> {
		// Use existing helper function instead of service method
		const instance = getNotebookInstanceFromActiveEditorPane(this._editorService);
		if (!instance) {
			return undefined;
		}

		// Get current state from observables
		const cells = instance.cells.get();
		const kernel = instance.kernel.get();
		const selectionState = instance.selectionStateMachine.state.get();

		// Map selected cells using helper function
		const selectedCells: INotebookCellDTO[] = [];
		const selectedCellsList = getSelectedCells(selectionState);
		for (const cell of selectedCellsList) {
			selectedCells.push(this.mapCellToDTO(cell));
		}

		// Include all cells - filtering will be done on the extension side
		const allCells = cells.map(cell => this.mapCellToDTO(cell));

		return {
			uri: instance.uri.toString(),
			kernelId: kernel?.id,
			kernelLanguage: kernel?.runtime.languageId,
			cellCount: cells.length,
			selectedCells,
			allCells
		};
	}

	/**
	 * Gets all cells from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @returns Array of all cells in the notebook.
	 */
	async $getCells(notebookUri: string): Promise<INotebookCellDTO[]> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellDTOs: INotebookCellDTO[] = [];

		for (const cell of cells) {
			cellDTOs.push(this.mapCellToDTO(cell));
		}

		return cellDTOs;
	}

	/**
	 * Gets a specific cell from a notebook by its index.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to retrieve.
	 * @returns The cell DTO, or undefined if not found.
	 */
	async $getCell(notebookUri: string, cellIndex: number): Promise<INotebookCellDTO | undefined> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			return undefined;
		}

		return this.mapCellToDTO(cells[cellIndex]);
	}

	/**
	 * Runs the specified cells in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndices Array of cell indices to run.
	 */
	async $runCells(notebookUri: string, cellIndices: number[]): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		const cellsToRun = cellIndices
			.filter(index => index >= 0 && index < cells.length)
			.map(index => cells[index]);

		if (cellsToRun.length === 0) {
			throw new Error(`No cells found with indices: ${cellIndices.join(', ')}`);
		}

		// Select the last cell in the range (somewhat arbitrary)
		const lastCell = cellsToRun[cellsToRun.length - 1];
		lastCell.select(CellSelectionType.Normal);

		await instance.runCells(cellsToRun);

		// Notify about assistant cell modification for follow mode
		// Notify for the last cell that was run
		const lastCellIndex = cellIndices[cellIndices.length - 1];
		if (lastCellIndex !== undefined) {
			instance.handleAssistantCellModification(lastCellIndex, 'run');
		}
	}

	/**
	 * Adds a new cell to a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param type The type of cell to add.
	 * @param index The index where the cell should be inserted.
	 * @param content The initial content for the cell.
	 * @returns The index of the newly created cell.
	 */
	async $addCell(notebookUri: string, type: NotebookCellType, index: number, content: string): Promise<number> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cellKind = type === NotebookCellType.Code ? CellKind.Code : CellKind.Markup;

		// Mark this as an assistant operation to prevent automatic selection/scrolling.
		// The follow mode will control reveal behavior based on user preferences.
		instance.setCurrentOperation(NotebookOperationType.AssistantAdd);
		instance.addCell(cellKind, index, false, content);

		// Notify about assistant cell modification for follow mode
		instance.handleAssistantCellModification(index, 'add');

		return index;
	}

	/**
	 * Deletes a cell from a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to delete.
	 */
	async $deleteCell(notebookUri: string, cellIndex: number): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		instance.deleteCell(cells[cellIndex]);

		// Notify about assistant cell modification for follow mode
		// Note: After deletion, the cellIndex may point to a different cell, but we still notify
		// to handle the case where the deleted cell was outside the viewport
		instance.handleAssistantCellModification(cellIndex, 'delete');
	}

	/**
	 * Updates the content of a cell in a notebook.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell to update.
	 * @param content The new content for the cell.
	 */
	async $updateCellContent(notebookUri: string, cellIndex: number, content: string): Promise<void> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		const cell = cells[cellIndex];

		// Get the cell's model to access its properties
		const cellModel = cell.model;

		// Use the notebook text model's applyEdits to replace the cell content
		// This preserves all other cell properties (language, outputs, metadata, etc.)
		const textModel = instance.textModel;
		if (!textModel) {
			throw new Error(`No text model for notebook: ${notebookUri}`);
		}

		const computeUndoRedo = !instance.isReadOnly || textModel.viewType === 'interactive';

		// Mark this as an assistant operation to prevent automatic selection/scrolling.
		// The follow mode will control reveal behavior based on user preferences.
		instance.setCurrentOperation(NotebookOperationType.AssistantEdit);

		textModel.applyEdits([
			{
				editType: CellEditType.Replace,
				index: cellIndex,
				count: 1,
				cells: [
					{
						source: content,
						language: cellModel.language,
						mime: cellModel.mime,
						cellKind: cellModel.cellKind,
						outputs: cellModel.outputs.map(output => ({
							outputId: output.outputId,
							outputs: output.outputs
						})),
						metadata: cellModel.metadata,
						internalMetadata: cellModel.internalMetadata
					}
				]
			}
		], true, undefined, () => undefined, undefined, computeUndoRedo);

		// Notify about assistant cell modification for follow mode
		instance.handleAssistantCellModification(cellIndex, 'edit');
	}

	/**
	 * Gets the outputs from a code cell.
	 * @param notebookUri The URI of the notebook as a string.
	 * @param cellIndex The index of the cell.
	 * @returns Array of output objects with MIME type and data (text or base64-encoded binary).
	 */
	async $getCellOutputs(notebookUri: string, cellIndex: number): Promise<INotebookCellOutputDTO[]> {
		const instance = this._getInstanceByUri(notebookUri);
		if (!instance) {
			throw new Error(`No notebook found with URI: ${notebookUri}`);
		}

		const cells = instance.cells.get();
		if (cellIndex < 0 || cellIndex >= cells.length) {
			throw new Error(`Cell not found at index: ${cellIndex}`);
		}

		const cell = cells[cellIndex];

		// Only code cells have outputs
		if (!cell.isCodeCell()) {
			return [];
		}

		// Get outputs from the observable
		const outputs = cell.outputs.get();

		// Convert outputs to structured DTOs
		const outputDTOs: INotebookCellOutputDTO[] = [];
		for (const output of outputs) {
			for (const item of output.outputs) {
				const mimeType = item.mime;

				// Handle stderr outputs with prefix
				if (mimeType === 'application/vnd.code.notebook.stderr') {
					outputDTOs.push({
						mimeType: mimeType,
						data: `[stderr] ${item.data.toString()}`
					});
				}
				// Handle image MIME types - base64 encode
				else if (isImageMimeType(mimeType)) {
					const base64Data = encodeBase64(item.data);
					outputDTOs.push({
						mimeType: mimeType,
						data: base64Data
					});
				}
				// Handle text-based MIME types - convert to string
				else if (isTextBasedMimeType(mimeType)) {
					outputDTOs.push({
						mimeType: mimeType,
						data: item.data.toString()
					});
				}
				// Unknown MIME type - log warning and default to base64 encoding (safer for unknown binary data)
				else {
					this._logService.warn(`Unknown MIME type "${mimeType}" in notebook cell output. Defaulting to base64 encoding.`);
					const base64Data = encodeBase64(item.data);
					outputDTOs.push({
						mimeType: mimeType,
						data: base64Data
					});
				}
			}
		}

		return outputDTOs;
	}

	/**
	 * Helper method to get a notebook instance by URI string.
	 * @param uriString The notebook URI as a string.
	 * @returns The notebook instance, or undefined if not found.
	 */
	private _getInstanceByUri(uriString: string): IPositronNotebookInstance | undefined {
		const uri = URI.parse(uriString);
		const instances = this._positronNotebookService.listInstances(uri);
		return instances.length > 0 ? instances[0] : undefined;
	}

	dispose(): void {
		this._disposables.dispose();
	}
}

