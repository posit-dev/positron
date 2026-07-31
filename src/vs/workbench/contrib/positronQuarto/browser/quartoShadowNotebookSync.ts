/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextBuffer, ITextBufferFactory, ITextModel } from '../../../../editor/common/model.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { CellEditType, CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { IQuartoDocumentModel } from '../common/quartoTypes.js';
import { computeShadowSyncActions, fenceLanguageToCellLanguage, ShadowCellEdit, ShadowCellSpec, ShadowCellSplice } from '../common/quartoShadowNotebook.js';

/**
 * Keeps a shadow notebook's cells in sync with a Quarto document.
 *
 * One-directional: the .qmd text model is the source of truth and the
 * notebook is derived state that is never edited directly. Driven by the
 * document model's `onDidParse` (debounced reparse of the text model).
 *
 * Structural changes (add/remove/reorder/language change) are applied as
 * cell splices; content changes are applied as in-place text edits on the
 * cell's text model so language servers see incremental didChange
 * notifications and keep their per-cell state.
 */
export class QuartoShadowNotebookSync extends Disposable {

	/**
	 * Cell text models this sync created, keyed by cell handle.
	 *
	 * In-place edits need a materialized `ITextModel` for the cell: editing
	 * the raw text buffer would bypass the cell's change events, and the
	 * extension host only receives cell text updates through the regular
	 * text-document sync channel, which mirrors models registered with
	 * `IModelService`. Models are created lazily on the first edit of a cell
	 * (mirroring `CellContentProvider`: the model shares the cell's text
	 * buffer) and disposed when the cell is removed.
	 */
	private readonly _cellTextModels = new Map<number, ITextModel>();

	constructor(
		private readonly _documentModel: IQuartoDocumentModel,
		private readonly _notebook: NotebookTextModel,
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._documentModel.onDidParse(() => this._sync()));

		// Reconcile immediately: the notebook was created from the text
		// model's content at creation time, but the document model may have
		// reparsed since (or the two may have drifted during async creation).
		this._sync();
	}

	override dispose(): void {
		for (const model of this._cellTextModels.values()) {
			model.dispose();
		}
		this._cellTextModels.clear();
		super.dispose();
	}

	/** Reconcile the notebook's cells against the current parse. */
	private _sync(): void {
		const newCells: ShadowCellSpec[] = this._documentModel.cells.map(cell => ({
			language: fenceLanguageToCellLanguage(cell.language),
			text: this._documentModel.getCellCode(cell),
		}));
		const oldCells: ShadowCellSpec[] = this._notebook.cells.map(cell => ({
			language: cell.language,
			text: cell.getValue(),
		}));

		const actions = computeShadowSyncActions(oldCells, newCells);
		for (const action of actions) {
			if (action.kind === 'splice') {
				this._applySplice(action);
			} else {
				this._applyEdit(action);
			}
		}

		if (actions.some(action => action.kind === 'splice')) {
			this._pruneCellTextModels();
		}
	}

	/** Replace a run of cells (structural change). */
	private _applySplice(splice: ShadowCellSplice): void {
		const cells: ICellDto2[] = splice.cells.map(cell => ({
			source: cell.text,
			language: cell.language,
			mime: undefined,
			cellKind: CellKind.Code,
			outputs: [],
		}));
		this._notebook.applyEdits(
			[{ editType: CellEditType.Replace, index: splice.index, count: splice.deleteCount, cells }],
			true,
			undefined,
			() => undefined,
			undefined,
			// The notebook is derived state; its edits must never enter an
			// undo stack (the .qmd text model owns undo).
			false,
		);
	}

	/** Apply an in-place text edit to one cell. */
	private _applyEdit(edit: ShadowCellEdit): void {
		const cell = this._notebook.cells[edit.index];
		if (!cell) {
			this._logService.warn(`[QuartoShadowNotebookSync] No cell at index ${edit.index} in ${this._notebook.uri.toString()}`);
			return;
		}
		const model = this._ensureCellTextModel(cell);
		const range = Range.fromPositions(model.getPositionAt(edit.start), model.getPositionAt(edit.end));
		model.applyEdits([{ range, text: edit.text }]);
	}

	/**
	 * Get or create the materialized text model for a cell.
	 *
	 * Mirrors `CellContentProvider` (notebook.contribution.ts): the model
	 * shares the cell's text buffer, and `NotebookTextModel` binds it to the
	 * cell via its `onModelAdded` hook, so edits flow through the cell's
	 * change events and the notebook's version counter.
	 */
	private _ensureCellTextModel(cell: NotebookCellTextModel): ITextModel {
		// A model may already exist, e.g. materialized by CellContentProvider
		// on behalf of another consumer. Use it but don't manage its lifetime.
		const existing = this._modelService.getModel(cell.uri);
		if (existing) {
			return existing;
		}

		const bufferFactory: ITextBufferFactory = {
			create: () => ({ textBuffer: cell.textBuffer as ITextBuffer, disposable: Disposable.None }),
			getFirstLineText: (limit: number) => cell.textBuffer.getLineContent(1).substring(0, limit),
		};
		const model = this._modelService.createModel(
			bufferFactory,
			this._languageService.createById(cell.language),
			cell.uri,
		);
		this._cellTextModels.set(cell.handle, model);
		return model;
	}

	/** Dispose text models whose cells were removed by a splice. */
	private _pruneCellTextModels(): void {
		const liveHandles = new Set(this._notebook.cells.map(cell => cell.handle));
		for (const [handle, model] of this._cellTextModels) {
			if (!liveHandles.has(handle)) {
				model.dispose();
				this._cellTextModels.delete(handle);
			}
		}
	}
}
