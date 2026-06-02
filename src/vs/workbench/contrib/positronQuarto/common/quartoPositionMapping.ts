/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from '../../../../editor/common/core/position.js';
import { IRange, Range } from '../../../../editor/common/core/range.js';
import { QuartoCodeCell } from './quartoTypes.js';

/**
 * Translation helpers between a `.qmd` document and the synthetic per-cell
 * text models that back its code chunks.
 *
 * A cell's synthetic model contains exactly the code lines of the chunk
 * (the lines from `codeStartLine` to `codeEndLine`, joined). Code chunk lines
 * are copied verbatim and start at column 0, so only the line number is
 * shifted between the two coordinate spaces; columns are identical.
 *
 * All line and column numbers are 1-based, matching the editor's
 * {@link Position} and {@link Range}.
 */

/**
 * Convert a document (`.qmd`) line number to the corresponding cell-model line
 * number. The caller is responsible for ensuring the line is inside the cell's
 * code (see {@link isInsideCellCode}).
 */
export function toCellLine(cell: QuartoCodeCell, documentLine: number): number {
	return documentLine - cell.codeStartLine + 1;
}

/**
 * Convert a cell-model line number to the corresponding document (`.qmd`) line
 * number.
 */
export function toDocumentLine(cell: QuartoCodeCell, cellLine: number): number {
	return cellLine + cell.codeStartLine - 1;
}

/**
 * Whether the given document line falls within a cell's code content (i.e. not
 * on the opening or closing fence lines, which are prose owned by the Quarto
 * extension). A cell with no code lines (`codeStartLine > codeEndLine`) always
 * returns `false`.
 */
export function isInsideCellCode(cell: QuartoCodeCell, documentLine: number): boolean {
	return documentLine >= cell.codeStartLine && documentLine <= cell.codeEndLine;
}

/** Convert a document position to a cell-model position. */
export function toCellPosition(cell: QuartoCodeCell, position: Position): Position {
	return new Position(toCellLine(cell, position.lineNumber), position.column);
}

/** Convert a cell-model position to a document position. */
export function toDocumentPosition(cell: QuartoCodeCell, position: Position): Position {
	return new Position(toDocumentLine(cell, position.lineNumber), position.column);
}

/** Convert a cell-model range to a document range. */
export function toDocumentRange(cell: QuartoCodeCell, range: IRange): Range {
	return new Range(
		toDocumentLine(cell, range.startLineNumber),
		range.startColumn,
		toDocumentLine(cell, range.endLineNumber),
		range.endColumn,
	);
}

/** Convert a document range to a cell-model range. */
export function toCellRange(cell: QuartoCodeCell, range: IRange): Range {
	return new Range(
		toCellLine(cell, range.startLineNumber),
		range.startColumn,
		toCellLine(cell, range.endLineNumber),
		range.endColumn,
	);
}
