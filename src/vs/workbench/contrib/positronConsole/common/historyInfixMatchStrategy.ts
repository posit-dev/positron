/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HistoryNavigator2 } from 'vs/base/common/history';
import { IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { HistoryMatch, HistoryMatchStrategy } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

export class HistoryInfixMatchStrategy extends HistoryMatchStrategy {
	constructor(protected readonly _navigator: HistoryNavigator2<IInputHistoryEntry>) {
		super();
	}

	override getMatches(input: string): HistoryMatch[] {
		const matches: HistoryMatch[] = [];
		for (const entry of this._navigator) {
			if (input.length > 0) {
				const matchIdx = entry.input.indexOf(input);
				if (matchIdx >= 0) {
					const match: HistoryMatch = {
						input: entry.input,
						highlights: [[matchIdx, matchIdx + input.length]]
					};
					matches.push(match);
				}
			} else {
				const match: HistoryMatch = {
					input: entry.input,
					highlights: []
				};
				matches.push(match);
			}
		}
		return matches;
	}
}
