/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * A history match, which is a string with a start and end index that indicates
 * where the match should be highlighted.
 */
export interface HistoryMatch {
	input: string;
	highlightStart: number;
	highlightEnd: number;
}

/**
 * A history match strategy is a class that can find matches in the history
 * given an input string to match agains.
 */
export abstract class HistoryMatchStrategy {
	abstract getMatches(input: string): HistoryMatch[];
}

/**
 * Default/placeholder history match strategy that never matches anything.
 */
export class EmptyHistoryMatchStrategy extends HistoryMatchStrategy {
	override getMatches(input: string): HistoryMatch[] {
		return [];
	}
}

