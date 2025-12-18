/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable, runOnChange } from '../../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { CurrentPositronCellMatch, PositronCellFindMatch } from './controller.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';

export class PositronNotebookFindDecorations extends Disposable {
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _currentMatchDecoration: { cellHandle: number; decorationId: string } | undefined;

	/** Tracks editor change listeners per cell handle for deferred decoration application */
	private readonly _cellEditorObservers = this._register(new DisposableMap<number>());

	/** Observer for pending current match when editor is not yet mounted */
	private readonly _currentMatchEditorObserver = this._register(new MutableDisposable());

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		private readonly _matches: IObservable<PositronCellFindMatch[]>,
		private readonly _currentMatch: IObservable<CurrentPositronCellMatch | undefined>,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Update all find match decorations when matches change
		this._register(autorun(reader => {
			const matches = this._matches.read(reader);
			const cells = this._notebook.cells.read(undefined);  // untracked read
			this._logService.trace(`[FindDecorations] Matches autorun triggered: ${matches.length} matches`);
			this._applyAllDecorations(matches, cells);
		}));

		// Update current match decoration when current match changes
		this._register(autorun(reader => {
			const currentMatch = this._currentMatch.read(reader);
			const cells = this._notebook.cells.read(undefined);  // untracked read

			// Clear any pending current match observer
			this._currentMatchEditorObserver.clear();

			// Reset the existing current match decoration, if one exists
			const oldDecoration = this._currentMatchDecoration;
			if (oldDecoration) {
				const { cellHandle, decorationId } = oldDecoration;
				const cell = cells.find(c => c.handle === cellHandle);
				if (cell?.currentEditor) {
					cell.currentEditor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(decorationId, FindDecorations._FIND_MATCH_DECORATION);
					});
				}
				this._currentMatchDecoration = undefined;
			}

			// Add the new current match decoration
			if (currentMatch) {
				const { cell, cellRange } = currentMatch.cellMatch;
				if (cell.currentEditor) {
					// Editor available - apply immediately
					this._applyCurrentMatch(cell, cellRange, cell.currentEditor);
				} else {
					// Editor not available - defer until mounted
					this._deferCurrentMatch(cell, cellRange);
				}
			}
		}));
	}

	private _applyAllDecorations(matches: PositronCellFindMatch[], cells: IPositronNotebookCell[]): void {
		this._logService.trace(`[FindDecorations] _applyAllDecorations START: ${matches.length} matches, ${cells.length} cells`);

		// Clear old editor observers
		const observerCount = this._cellEditorObservers.size;
		this._cellEditorObservers.clearAndDisposeAll();
		this._logService.trace(`[FindDecorations] Cleared ${observerCount} pending editor observers`);

		// Create cell lookup map for efficient access
		const cellsByHandle = new Map<number, IPositronNotebookCell>();
		for (const cell of cells) {
			cellsByHandle.set(cell.handle, cell);
		}

		// Group matches by cell handle
		const newDecorationsByCellHandle = new Map<number, IModelDeltaDecoration[]>();
		for (const cellMatch of matches) {
			const cellHandle = cellMatch.cell.handle;
			let decorations = newDecorationsByCellHandle.get(cellHandle);
			if (!decorations) {
				decorations = [];
				newDecorationsByCellHandle.set(cellHandle, decorations);
			}
			decorations.push({
				range: cellMatch.cellRange.range,
				options: FindDecorations._FIND_MATCH_DECORATION,
			});
		}

		// Create empty decorations for cells that no longer have matches
		for (const cellHandle of this._decorationIdsByCellHandle.keys()) {
			if (!newDecorationsByCellHandle.has(cellHandle)) {
				newDecorationsByCellHandle.set(cellHandle, []);
			}
		}

		// Update decorations for each cell
		for (const [cellHandle, decorations] of newDecorationsByCellHandle.entries()) {
			const cell = cellsByHandle.get(cellHandle);
			if (!cell) {
				this._logService.trace(`[FindDecorations] Cell handle ${cellHandle} not found in cells list`);
				continue;
			}

			this._logService.trace(
				`[FindDecorations] Cell ${cellHandle}: ` +
				`hasEditor=${Boolean(cell.currentEditor)}, ` +
				`decorations=${decorations.length}`
			);

			if (cell.currentEditor) {
				// Editor available - apply immediately
				this._logService.trace(`[FindDecorations] Cell ${cellHandle}: Applying immediately`);
				this._applyDecorations(cell.currentEditor, cellHandle, decorations);
			} else if (decorations.length > 0) {
				// Editor not available but has matches - defer until mounted
				this._logService.trace(`[FindDecorations] Cell ${cellHandle}: Deferring (editor not mounted)`);
				this._deferDecorations(cell, cellHandle, decorations);
			}
		}
	}

	private _deferDecorations(
		cell: IPositronNotebookCell,
		cellHandle: number,
		decorations: IModelDeltaDecoration[]
	): void {
		this._logService.trace(`[FindDecorations] _deferDecorations: Setting up observer for cell ${cellHandle}`);

		const disposables = new DisposableStore();

		// Watch for editor changes on this cell
		disposables.add(runOnChange(cell.editor, editor => {
			this._logService.trace(
				`[FindDecorations] _deferDecorations CALLBACK: Cell ${cellHandle} editor changed to ${editor ? 'mounted' : 'unmounted'}`
			);
			if (editor) {
				if (editor.hasModel()) {
					// Editor has model - apply decorations immediately
					this._logService.trace(`[FindDecorations] Cell ${cellHandle}: Editor has model, applying deferred decorations now`);
					this._applyDecorations(editor, cellHandle, decorations);
					this._cellEditorObservers.deleteAndDispose(cellHandle);
				} else {
					// Editor exists but no model yet - wait for model
					this._logService.trace(`[FindDecorations] Cell ${cellHandle}: Editor has no model, waiting for onDidChangeModel`);
					disposables.add(editor.onDidChangeModel(e => {
						if (e.newModelUrl) {
							this._logService.trace(`[FindDecorations] Cell ${cellHandle}: Model attached, applying deferred decorations now`);
							this._applyDecorations(editor, cellHandle, decorations);
							this._cellEditorObservers.deleteAndDispose(cellHandle);
						}
					}));
				}
			}
		}));

		this._cellEditorObservers.set(cellHandle, disposables);
		this._logService.trace(`[FindDecorations] _deferDecorations: Observer registered, total observers: ${this._cellEditorObservers.size}`);
	}

	private _applyDecorations(editor: ICodeEditor, cellHandle: number, decorations: IModelDeltaDecoration[]): void {
		this._logService.trace(`[FindDecorations] _applyDecorations: Cell ${cellHandle}, ${decorations.length} decorations`);

		editor.changeDecorations(accessor => {
			const oldDecorationIds = this._decorationIdsByCellHandle.get(cellHandle) ?? [];
			const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, decorations);
			this._decorationIdsByCellHandle.set(cellHandle, newDecorationIds);

			this._logService.trace(
				`[FindDecorations] _applyDecorations COMPLETE: Cell ${cellHandle}, ` +
				`old=${oldDecorationIds.length}, new=${newDecorationIds.length}`
			);
		});
	}

	private _applyCurrentMatch(
		cell: IPositronNotebookCell,
		cellRange: PositronCellFindMatch['cellRange'],
		editor: ICodeEditor
	): void {
		let newCurrentDecorationId: string | null = null;

		if (cellRange.range) {
			const decorationIds = this._decorationIdsByCellHandle.get(cell.handle) ?? [];
			for (const decorationId of decorationIds) {
				const model = editor.getModel();
				if (model) {
					const range = model.getDecorationRange(decorationId);
					if (cellRange.range.equalsRange(range)) {
						newCurrentDecorationId = decorationId;
						break;
					}
				}
			}
		}

		if (newCurrentDecorationId !== null) {
			editor.changeDecorations(accessor => {
				accessor.changeDecorationOptions(newCurrentDecorationId, FindDecorations._CURRENT_FIND_MATCH_DECORATION);
			});
			this._currentMatchDecoration = { cellHandle: cell.handle, decorationId: newCurrentDecorationId };
		}
	}

	private _deferCurrentMatch(cell: IPositronNotebookCell, cellRange: PositronCellFindMatch['cellRange']): void {
		const disposables = new DisposableStore();

		// Watch for editor changes on this cell
		disposables.add(runOnChange(cell.editor, editor => {
			if (editor) {
				if (editor.hasModel()) {
					// Editor has model - apply current match decoration immediately
					this._applyCurrentMatch(cell, cellRange, editor);
					this._currentMatchEditorObserver.clear();
				} else {
					// Editor exists but no model yet - wait for model
					disposables.add(editor.onDidChangeModel(e => {
						if (e.newModelUrl) {
							this._applyCurrentMatch(cell, cellRange, editor);
							this._currentMatchEditorObserver.clear();
						}
					}));
				}
			}
		}));

		this._currentMatchEditorObserver.value = disposables;
	}
}
