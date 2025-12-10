/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { autorun, IObservable } from '../../../../../../base/common/observable.js';
import { IModelDeltaDecoration } from '../../../../../../editor/common/model.js';
import { FindDecorations } from '../../../../../../editor/contrib/find/browser/findDecorations.js';
import { IPositronNotebookCell } from '../../PositronNotebookCells/IPositronNotebookCell.js';
import { PositronCellFindMatch } from './positronNotebookFind.js';

export class PositronNotebookFindDecorations extends Disposable {
	private readonly _decorationIdsByCellHandle = new Map<number, string[]>();
	private _currentMatchDecorationId: { cell: IPositronNotebookCell; decorationId: string } | undefined;

	constructor(
		private readonly _matches: IObservable<PositronCellFindMatch[]>,
		private readonly _currentMatch: IObservable<{ cellMatch: PositronCellFindMatch; index: number } | undefined>,
	) {
		super();

		this._register(autorun(reader => {
			const allMatches = this._matches.read(reader);

			// Group matches by cell
			const cellMatchesByCell = new Map<IPositronNotebookCell, PositronCellFindMatch[]>();
			for (const cellMatch of allMatches) {
				let cellMatches = cellMatchesByCell.get(cellMatch.cell);
				if (!cellMatches) {
					cellMatches = [];
					cellMatchesByCell.set(cellMatch.cell, cellMatches);
				}
				cellMatches.push(cellMatch);
			}

			// Update all cell editor decorations
			for (const [cell, cellMatches] of cellMatchesByCell.entries()) {
				if (!cell.editor) {
					continue;
				}

				const newDecorations: IModelDeltaDecoration[] = cellMatches.map(cellMatch => ({
					range: cellMatch.cellRange.range,
					options: FindDecorations._FIND_MATCH_DECORATION,
				}));

				cell.editor.changeDecorations(accessor => {
					const oldDecorationIds = this._decorationIdsByCellHandle.get(cell.handle) || [];
					const newDecorationIds = accessor.deltaDecorations(oldDecorationIds, newDecorations);
					this._decorationIdsByCellHandle.set(cell.handle, newDecorationIds);
				});
			}
		}));

		this._register(autorun(reader => {
			const currentMatch = this._currentMatch.read(reader);

			// Reset the existing current match decoration, if one exists
			const oldDecoration = this._currentMatchDecorationId;
			if (oldDecoration) {
				const { cell, decorationId } = oldDecoration;
				if (cell.editor) {
					cell.editor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(decorationId, FindDecorations._FIND_MATCH_DECORATION);
					});
				}
				this._currentMatchDecorationId = undefined;
			}

			// Add the new current match decoration
			if (currentMatch) {
				const { cell, cellRange } = currentMatch.cellMatch;
				if (!cell.editor) {
					return;
				}

				let newCurrentDecorationId: string | null = null;
				if (cellRange.range) {
					const decorationIds = this._decorationIdsByCellHandle.get(cell.handle) ?? [];
					for (const decorationId of decorationIds) {
						const model = cell.editor.getModel();
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
					cell.editor.changeDecorations(accessor => {
						accessor.changeDecorationOptions(newCurrentDecorationId, FindDecorations._CURRENT_FIND_MATCH_DECORATION);
					});

					this._currentMatchDecorationId = { cell, decorationId: newCurrentDecorationId };
				}
			}
		}));
	}
}
