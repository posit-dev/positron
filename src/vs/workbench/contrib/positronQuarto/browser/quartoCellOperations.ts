/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISingleEditOperation, EditOperation } from '../../../../editor/common/core/editOperation.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';

/**
 * Pure helpers that compute the text edits for Quarto cell manipulation
 * (delete, join). These are separated from the toolbar controller so they can
 * be unit-tested directly against a text model without an editor instance.
 */

/**
 * Compute the edit that deletes an entire code cell (its opening fence, code,
 * and closing fence). A single blank line immediately following the cell is
 * collapsed as well so deleting a cell does not leave a doubled gap behind.
 *
 * @param textModel The document's text model.
 * @param cell The cell to delete.
 * @returns A single delete edit operation.
 */
export function computeDeleteCellEdit(textModel: ITextModel, cell: QuartoCodeCell): ISingleEditOperation[] {
	const lineCount = textModel.getLineCount();

	// Collapse a single trailing blank line so we don't leave a double gap.
	let endLine = cell.endLine;
	if (endLine < lineCount && textModel.getLineContent(endLine + 1).trim() === '') {
		endLine += 1;
	}

	let range: Range;
	if (endLine < lineCount) {
		// Delete from the start of the cell through the start of the following
		// line, which removes the cell's lines and their trailing newline.
		range = new Range(cell.startLine, 1, endLine + 1, 1);
	} else {
		// The cell extends to the last line of the document. Consume the
		// preceding newline (if any) instead so we don't leave a trailing
		// empty line behind.
		const startLine = cell.startLine > 1 ? cell.startLine - 1 : 1;
		const startColumn = cell.startLine > 1 ? textModel.getLineMaxColumn(cell.startLine - 1) : 1;
		range = new Range(startLine, startColumn, endLine, textModel.getLineMaxColumn(endLine));
	}

	return [EditOperation.delete(range)];
}

/**
 * Compute the edits that join two code cells into one. Quarto cell options (the
 * leading `#|` comment lines) from both cells are gathered at the top of the
 * merged cell with duplicates removed (first occurrence wins), followed by the
 * code of the first cell and then the code of the second cell. The second cell
 * is removed entirely; any prose written between the two cells is left in place,
 * after the merged cell.
 *
 * @param textModel The document's text model.
 * @param firstCell The earlier cell (its opening fence is kept; receives the merged content).
 * @param secondCell The later cell (its content is merged into the first cell, then it is removed).
 * @returns The edit operations that perform the join.
 */
export function computeJoinCellsEdit(textModel: ITextModel, firstCell: QuartoCodeCell, secondCell: QuartoCodeCell): ISingleEditOperation[] {
	const first = splitCellOptions(getCellCodeLines(textModel, firstCell));
	const second = splitCellOptions(getCellCodeLines(textModel, secondCell));

	// Merge option lines, dropping duplicates (keyed by trimmed text) while
	// preserving the order of first appearance.
	const seen = new Set<string>();
	const options: string[] = [];
	for (const line of [...first.options, ...second.options]) {
		const key = line.trim();
		if (!seen.has(key)) {
			seen.add(key);
			options.push(line);
		}
	}

	const mergedBody = [...options, ...first.code, ...second.code];

	const edits: ISingleEditOperation[] = [];

	// Replace the first cell's code region with the merged body. When the first
	// cell has no code lines, insert the merged body just before its closing fence.
	if (firstCell.codeStartLine <= firstCell.codeEndLine) {
		const range = new Range(firstCell.codeStartLine, 1, firstCell.codeEndLine, textModel.getLineMaxColumn(firstCell.codeEndLine));
		edits.push({ range, text: mergedBody.join('\n') });
	} else if (mergedBody.length > 0) {
		edits.push({ range: new Range(firstCell.endLine, 1, firstCell.endLine, 1), text: mergedBody.join('\n') + '\n' });
	}

	// Remove the second cell entirely (its fences and code), leaving the prose
	// between the two cells intact. The delete is computed against the original
	// line numbers, the same coordinate space as the replacement above.
	edits.push(...computeDeleteCellEdit(textModel, secondCell));

	return edits;
}

/**
 * The result of computing a cell insertion: the edits to apply and the 1-based
 * line number where the cursor should land (the new cell's empty code line).
 */
export interface InsertCellEdit {
	readonly edits: ISingleEditOperation[];
	readonly cursorLine: number;
}

/**
 * Compute the edit that inserts a new, empty code cell at the start of the
 * given line (1-based), guaranteeing at least one blank buffer line between the
 * new cell and its neighbors on both sides (except at the very top/bottom of
 * the document). The returned `cursorLine` is the new cell's empty code line.
 *
 * Computed as a direct edit (rather than delegating to the Quarto extension's
 * insert command) so the cell always lands exactly where the user asked,
 * without skipping past prose or abutting an adjacent fence.
 *
 * @param textModel The document's text model.
 * @param language The cell language (e.g. `python`, `r`); falls back to `python` when empty.
 * @param insertLine The 1-based line at whose start to insert. A value past the
 * last line appends to the end of the document.
 * @returns The edit operations and the resulting cursor line.
 */
export function computeInsertCellEdit(textModel: ITextModel, language: string, insertLine: number): InsertCellEdit {
	const lineCount = textModel.getLineCount();
	const fence = '```{' + (language || 'python') + '}';
	// Opening fence, an empty code line (where the cursor lands), closing fence.
	const cellBlock = fence + '\n\n```';

	if (insertLine > lineCount) {
		// Appending past the last line (e.g. inserting below a cell whose
		// closing fence is the final line of the document).
		const lastLineBlank = textModel.getLineContent(lineCount).trim() === '';
		const prefixNewlines = lastLineBlank ? 1 : 2;
		const text = '\n'.repeat(prefixNewlines) + cellBlock + '\n';
		const endColumn = textModel.getLineMaxColumn(lineCount);
		return {
			edits: [{ range: new Range(lineCount, endColumn, lineCount, endColumn), text }],
			cursorLine: lineCount + prefixNewlines + 1,
		};
	}

	// Insert before the content of `insertLine`. Add a leading blank line
	// unless we're at the top of the document or the line above is already
	// blank; add a trailing blank line unless the line below is already blank.
	const aboveBlank = insertLine <= 1 || textModel.getLineContent(insertLine - 1).trim() === '';
	const belowBlank = textModel.getLineContent(insertLine).trim() === '';
	const prefix = aboveBlank ? '' : '\n';
	const suffix = belowBlank ? '\n' : '\n\n';
	const text = prefix + cellBlock + suffix;
	return {
		edits: [{ range: new Range(insertLine, 1, insertLine, 1), text }],
		// The empty code line sits one line below the opening fence.
		cursorLine: insertLine + (prefix ? 1 : 0) + 1,
	};
}

/**
 * Get the code lines (between the fences) of a cell.
 */
function getCellCodeLines(textModel: ITextModel, cell: QuartoCodeCell): string[] {
	const lines: string[] = [];
	for (let i = cell.codeStartLine; i <= cell.codeEndLine; i++) {
		lines.push(textModel.getLineContent(i));
	}
	return lines;
}

/**
 * Split a cell's code lines into the leading run of Quarto option lines (`#|`)
 * and the remaining code. Option lines are only recognized at the very top of
 * the cell, matching Quarto's requirement; the first non-option line ends the
 * option block and everything after it is treated as code.
 */
function splitCellOptions(lines: string[]): { options: string[]; code: string[] } {
	let i = 0;
	while (i < lines.length && isCellOptionLine(lines[i])) {
		i++;
	}
	return { options: lines.slice(0, i), code: lines.slice(i) };
}

/**
 * Whether a line is a Quarto cell option line. These are line comments that
 * begin with `#|` (R, Python, Julia), optionally indented.
 */
function isCellOptionLine(line: string): boolean {
	return /^\s*#\|/.test(line);
}
