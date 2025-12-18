/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../base/common/observable.js';
import { IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { CurrentPositronCellMatch, PositronCellFindMatch } from './controller.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { getOrSet } from '../../../../../../base/common/map.js';

export class PositronNotebookFindDecorations extends Disposable {
	/** Decoration IDs per cell handle */
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();

	/** Current match decoration - tracked separately for efficient updates */
	private _currentMatchDecorationId: string | undefined;
	private _currentMatchCellHandle: number | undefined;

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
			this._updateMatches(matches, cells);
		}));

		// Update current match decoration when current match changes
		this._register(autorun(reader => {
			const currentMatch = this._currentMatch.read(reader);
			const cells = this._notebook.cells.read(undefined);  // untracked read
			this._updateCurrentMatch(currentMatch, cells);
		}));
	}

	private _updateMatches(matches: PositronCellFindMatch[], cells: IPositronNotebookCell[]): void {
		this._logService.trace(`[FindDecorations] _updateMatches START: ${matches.length} matches, ${cells.length} cells`);

		// Group matches by cell handle
		const newDecorationsByCellHandle = new Map<number, IModelDeltaDecoration[]>();
		for (const { cell, cellRange } of matches) {
			const decorations = getOrSet(newDecorationsByCellHandle, cell.handle, []);
			decorations.push({
				range: cellRange.range,
				options: FindDecorations._FIND_MATCH_DECORATION,
			});
		}

		// Update decorations for each cell
		const cellsByHandle = new Map(cells.map(cell => [cell.handle, cell]));

		for (const cellHandle of this._decorationIdsByCellHandle.keys()) {
			if (!cellsByHandle.has(cellHandle)) {
				// Clean up decoration IDs for cells that no longer exist (were deleted)
				this._decorationIdsByCellHandle.delete(cellHandle);
			} else if (!newDecorationsByCellHandle.has(cellHandle)) {
				// Create empty decorations for cells that no longer have matches
				newDecorationsByCellHandle.set(cellHandle, []);
			}
		}

		for (const [cellHandle, decorations] of newDecorationsByCellHandle.entries()) {
			const cell = cellsByHandle.get(cellHandle);
			if (!cell) {
				continue;
			}

			// Cell handles deferral internally via CellDecorationManager!
			const oldIds = this._decorationIdsByCellHandle.get(cellHandle) ?? [];
			const newIds = cell.deltaModelDecorations(oldIds, decorations);

			this._logService.trace(
				`[FindDecorations] Cell ${cellHandle}: ` +
				`old=${oldIds.length}, new=${newIds.length}`
			);

			if (newIds.length > 0) {
				this._decorationIdsByCellHandle.set(cellHandle, newIds);
			} else {
				this._decorationIdsByCellHandle.delete(cellHandle);
			}
		}
	}

	private _updateCurrentMatch(
		currentMatch: CurrentPositronCellMatch | undefined,
		cells: IPositronNotebookCell[]
	): void {
		// Remove old current match decoration
		if (this._currentMatchDecorationId !== undefined && this._currentMatchCellHandle !== undefined) {
			const oldCell = cells.find(c => c.handle === this._currentMatchCellHandle);
			if (oldCell) {
				oldCell.deltaModelDecorations([this._currentMatchDecorationId], []);
			}
			this._currentMatchDecorationId = undefined;
			this._currentMatchCellHandle = undefined;
		}

		// Add new current match decoration (separate from regular matches)
		if (currentMatch) {
			const { cell, cellRange } = currentMatch.cellMatch;
			const [newId] = cell.deltaModelDecorations([], [{
				range: cellRange.range,
				options: FindDecorations._CURRENT_FIND_MATCH_DECORATION,
			}]);
			this._currentMatchDecorationId = newId;
			this._currentMatchCellHandle = cell.handle;
		}
	}
}
