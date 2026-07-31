/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../../../../../../base/common/charCode.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { SearchParams, Searcher } from '../../../../../../editor/common/model/textModelSearch.js';
import { CellEditorPosition, ICellEditorPosition } from '../../../common/editor/position.js';
import { CellEditorRange } from '../../../common/editor/range.js';

/** Whether a find match is in a cell's source text or in its rendered outputs. */
export type PositronCellFindMatchKind = 'input' | 'output';

/** The subset of a cell find match needed to order it against an editor position. */
interface IOrderableCellMatch {
	readonly kind: PositronCellFindMatchKind;
	readonly cellRange: CellEditorRange;
}

/**
 * Finds all matches of a search in a cell's plain-text output content.
 *
 * Uses the same regex construction and whole-word validation as the editor's
 * text model search (SearchParams/Searcher) so output matches behave like
 * source matches. The returned ranges are 1-based positions within `text`;
 * they establish match order and identity but are not editor ranges, so they
 * must not be used for editor decorations or selections.
 *
 * @param wordSeparators Word separator characters for whole-word matching, or
 *   null to allow partial-word matches.
 * @returns Match ranges in document order.
 */
export function findMatchesInOutputText(
	text: string,
	searchString: string,
	isRegex: boolean,
	matchCase: boolean,
	wordSeparators: string | null,
	limitResultCount: number = Number.MAX_SAFE_INTEGER,
): Range[] {
	if (text.length === 0 || searchString.length === 0 || limitResultCount <= 0) {
		return [];
	}

	const searchData = new SearchParams(searchString, isRegex, matchCase, wordSeparators).parseSearchRequest();
	if (!searchData) {
		// Invalid search (e.g. malformed regex)
		return [];
	}

	const lineStarts = computeLineStarts(text);
	const searcher = new Searcher(searchData.wordSeparators, searchData.regex);
	searcher.reset(0);

	const result: Range[] = [];
	let m: RegExpExecArray | null;
	while ((m = searcher.next(text)) !== null) {
		const start = positionAt(lineStarts, m.index);
		const end = positionAt(lineStarts, m.index + m[0].length);
		result.push(new Range(start.lineNumber, start.column, end.lineNumber, end.column));
		if (result.length >= limitResultCount) {
			break;
		}
	}
	return result;
}

/**
 * Whether the match starts at or after the given cursor position. A match
 * containing the position counts as at the position.
 *
 * Output matches render below their cell's editor, so within the cursor's own
 * cell (or any later cell) they always count as after the position.
 */
export function isMatchAtOrAfterPosition(match: IOrderableCellMatch, position: ICellEditorPosition): boolean {
	if (match.kind === 'output') {
		return match.cellRange.cellIndex >= position.cellIndex;
	}
	return match.cellRange.containsPosition(position)
		|| CellEditorPosition.isBefore(position, match.cellRange.getStartPosition());
}

/**
 * Whether the match ends at or before the given cursor position. A match
 * containing the position counts as at the position.
 *
 * Output matches render below their cell's editor, so they count as before an
 * editor position only when they are in an earlier cell.
 */
export function isMatchAtOrBeforePosition(match: IOrderableCellMatch, position: ICellEditorPosition): boolean {
	if (match.kind === 'output') {
		return match.cellRange.cellIndex < position.cellIndex;
	}
	return match.cellRange.containsPosition(position)
		|| match.cellRange.getEndPosition().isBefore(position);
}

/** Offsets of each line start in `text` (index i holds the offset of line i+1). */
function computeLineStarts(text: string): number[] {
	const lineStarts = [0];
	for (let i = 0; i < text.length; i++) {
		if (text.charCodeAt(i) === CharCode.LineFeed) {
			lineStarts.push(i + 1);
		}
	}
	return lineStarts;
}

/** Convert a character offset in the text to a 1-based line/column position. */
function positionAt(lineStarts: number[], offset: number): { lineNumber: number; column: number } {
	// Binary search for the last line start at or before the offset.
	let low = 0;
	let high = lineStarts.length - 1;
	while (low < high) {
		const mid = (low + high + 1) >> 1;
		if (lineStarts[mid] <= offset) {
			low = mid;
		} else {
			high = mid - 1;
		}
	}
	return { lineNumber: low + 1, column: offset - lineStarts[low] + 1 };
}
