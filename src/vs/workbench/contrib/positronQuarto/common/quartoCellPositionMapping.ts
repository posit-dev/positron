/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPosition } from '../../../../editor/common/core/position.js';
import { IRange } from '../../../../editor/common/core/range.js';

/**
 * The code of a cell within its source document, as 1-based inclusive line
 * numbers. The fence lines are not part of the span.
 *
 * A chunk with no code puts its fences on consecutive lines, which gives a span
 * whose end is before its start. Such a span contains no lines, which is what
 * the functions here report.
 */
export interface ICellLineSpan {
	readonly codeStartLine: number;
	readonly codeEndLine: number;
}

/**
 * How far the cell's code sits below the start of the source document.
 *
 * Only lines shift. Columns are the same in both coordinate spaces, because the
 * Quarto parser recognizes a fence only when it starts at column 0, so cell code
 * is never indented relative to its source.
 */
function lineDelta(cell: ICellLineSpan): number {
	return cell.codeStartLine - 1;
}

function containsLine(cell: ICellLineSpan, lineNumber: number): boolean {
	return lineNumber >= cell.codeStartLine && lineNumber <= cell.codeEndLine;
}

/**
 * Map a position in the source document into the cell's coordinate space.
 * Returns `undefined` when the position is outside the cell's code, including
 * on either fence line.
 */
export function sourcePositionToCell(cell: ICellLineSpan, position: IPosition): IPosition | undefined {
	if (!containsLine(cell, position.lineNumber)) {
		return undefined;
	}
	return { lineNumber: position.lineNumber - lineDelta(cell), column: position.column };
}

/**
 * Map a position in a cell back into source document coordinates.
 */
export function cellPositionToSource(cell: ICellLineSpan, position: IPosition): IPosition {
	return { lineNumber: position.lineNumber + lineDelta(cell), column: position.column };
}

/**
 * Map a range in the source document into the cell's coordinate space. Returns
 * `undefined` unless the whole range is inside the cell's code, so a range that
 * reaches a fence or the prose around it is rejected rather than clamped.
 */
export function sourceRangeToCell(cell: ICellLineSpan, range: IRange): IRange | undefined {
	if (!containsLine(cell, range.startLineNumber) || !containsLine(cell, range.endLineNumber)) {
		return undefined;
	}
	const delta = lineDelta(cell);
	return {
		startLineNumber: range.startLineNumber - delta,
		startColumn: range.startColumn,
		endLineNumber: range.endLineNumber - delta,
		endColumn: range.endColumn,
	};
}

/**
 * Map a range in a cell back into source document coordinates.
 */
export function cellRangeToSource(cell: ICellLineSpan, range: IRange): IRange {
	const delta = lineDelta(cell);
	return {
		startLineNumber: range.startLineNumber + delta,
		startColumn: range.startColumn,
		endLineNumber: range.endLineNumber + delta,
		endColumn: range.endColumn,
	};
}
