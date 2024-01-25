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
		let previousInput = '';
		for (const entry of this._navigator) {
			// Ignore this entry if it's the same as the previous one or the
			// same as the previous match
			if (entry.input === previousInput ||
				entry.input === matches[matches.length - 1]?.input) {
				continue;
			}
			if (input.length > 0) {
				const matchIdx = entry.input.indexOf(input);
				if (matchIdx >= 0) {
					const match: HistoryMatch = {
						input: entry.input,
						highlightStart: matchIdx,
						highlightEnd: matchIdx + input.length
					};
					matches.push(match);
				}
			} else {
				const match: HistoryMatch = {
					input: entry.input,
					highlightStart: 0,
					highlightEnd: 0
				};
				matches.push(match);
			}
			previousInput = entry.input;
		}
		return matches;
	}
}
