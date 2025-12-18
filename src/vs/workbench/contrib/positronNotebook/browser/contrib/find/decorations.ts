/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../base/common/observable.js';
import { IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { CurrentPositronCellMatch, PositronCellFindMatch } from './controller.js';

export class PositronNotebookFindDecorations extends Disposable {
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _currentMatchDecoration: { cellHandle: number; decorationId: string } | undefined;

	constructor(
		private readonly _notebook: IPositronNotebookInstance,
		private readonly _matches: IObservable<PositronCellFindMatch[]>,
		private readonly _currentMatch: IObservable<CurrentPositronCellMatch | undefined>,
	) {
		super();

		// Update all find match decorations when matches change
		this._register(autorun(reader => {
			const matches = this._matches.read(reader);
			const cells = this._notebook.cells.read(undefined);  // untracked read

			// Create new decorations for matches grouped by cell handle
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

			// Update all decorations
			for (const [cellHandle, decorations] of newDecorationsByCellHandle.entries()) {
				const cell = cells.find(c => c.handle === cellHandle);
				if (cell?.currentEditor) {
					cell.currentEditor.changeDecorations(accessor => {
						const oldDecorationIds = this._decorationIdsByCellHandle.get(cellHandle) ?? [];
						const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, decorations);
						this._decorationIdsByCellHandle.set(cellHandle, newDecorationIds);
					});
				}
			}
		}));

		// Update current match decoration when current match changes
		this._register(autorun(reader => {
			const currentMatch = this._currentMatch.read(reader);
			const cells = this._notebook.cells.read(undefined);  // untracked read

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
				if (!cell.currentEditor) {
					return;
				}

				let newCurrentDecorationId: string | null = null;
				if (cellRange.range) {
					const decorationIds = this._decorationIdsByCellHandle.get(cell.handle) ?? [];
					for (const decorationId of decorationIds) {
						const model = cell.currentEditor.getModel();
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
					cell.currentEditor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(newCurrentDecorationId, FindDecorations._CURRENT_FIND_MATCH_DECORATION);
					});

					this._currentMatchDecoration = { cellHandle: cell.handle, decorationId: newCurrentDecorationId };
				}
			}
		}));
	}
}
