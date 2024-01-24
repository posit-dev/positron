/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HistoryNavigator2 } from 'vs/base/common/history';
import { IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { HistoryMatch, HistoryMatchStrategy } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

export class HistoryPrefixMatchStrategy extends HistoryMatchStrategy {
	constructor(protected readonly _navigator: HistoryNavigator2<IInputHistoryEntry>) {
		super();
	}

	override getMatches(input: string): HistoryMatch[] {
		const matches: HistoryMatch[] = [];
		for (const entry of this._navigator) {
			if (entry.input.startsWith(input)) {
				const match: HistoryMatch = {
					input: entry.input,
					highlights: [[0, input.length]]
				};
				matches.push(match);
			}
		}
		return matches;
	}
}
