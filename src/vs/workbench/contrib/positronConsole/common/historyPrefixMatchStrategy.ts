/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { HistoryNavigator2 } from 'vs/base/common/history';
import { IInputHistoryEntry } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { HistoryMatch, HistoryMatchStrategy } from 'vs/workbench/contrib/positronConsole/common/historyMatchStrategy';

/**
 * A history match strategy that matches the input at the beginning of the
 * string. It mimics RStudio's Cmd+Up history search mode.
 */
export class HistoryPrefixMatchStrategy extends HistoryMatchStrategy {
	constructor(protected readonly _navigator: HistoryNavigator2<IInputHistoryEntry>) {
		super();
	}

	/**
	 * Matches the input at the beginning of the string.
	 *
	 * @param input The input to match
	 * @returns The array of matches
	 */
	override getMatches(input: string): HistoryMatch[] {
		const matches: HistoryMatch[] = [];
		let previousInput = '';
		for (const entry of this._navigator) {
			// Duplicate suppression: Ignore this entry if it's the same as the
			// previous one or the same as the previous match
			if (entry.input === previousInput ||
				entry.input === matches[matches.length - 1]?.input) {
				continue;
			}

			// If the input starts with the entry's input, highlight it and
			// match it
			if (entry.input.startsWith(input)) {
				const match: HistoryMatch = {
					input: entry.input,
					highlightStart: 0,
					highlightEnd: input.length
				};
				matches.push(match);
			}
			previousInput = entry.input;
		}
		return matches;
	}
}
