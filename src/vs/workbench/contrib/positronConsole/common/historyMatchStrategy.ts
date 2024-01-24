/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface HistoryMatch {
	input: string;
	highlights: [number, number][];
}

export abstract class HistoryMatchStrategy {
	abstract getMatches(input: string): HistoryMatch[];
}

export class EmptyHistoryMatchStrategy extends HistoryMatchStrategy {
	override getMatches(input: string): HistoryMatch[] {
		return [];
	}
}

