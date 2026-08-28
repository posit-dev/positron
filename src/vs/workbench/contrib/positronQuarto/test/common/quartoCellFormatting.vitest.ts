/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TextEdit } from '../../../../../editor/common/languages.js';
import {
	countProtectedLeadingLines,
	editsWithinCell,
	resolveProtectedLineEdits,
	withoutNoOpEdits,
	withoutTrailingNewlineAtCellEnd,
} from '../../common/quartoCellFormatting.js';

/** A text edit, written the way a formatter hands one over. */
function edit(
	startLineNumber: number, startColumn: number,
	endLineNumber: number, endColumn: number,
	text: string
): TextEdit {
	return { range: { startLineNumber, startColumn, endLineNumber, endColumn }, text };
}

/** The shape of an edit list, for comparing without the range boilerplate. */
function shapes(edits: readonly TextEdit[] | undefined): string[] | undefined {
	return edits?.map(item =>
		`(${item.range.startLineNumber},${item.range.startColumn})-` +
		`(${item.range.endLineNumber},${item.range.endColumn}) -> ${JSON.stringify(item.text)}`);
}

describe('countProtectedLeadingLines', () => {
	it('counts the option-line spellings Quarto recognizes, and stops at the first other line', () => {
		// Every variant `optionCommentPattern` accepts, which is
		// `^<comment>\s*\| ?` in the Quarto extension.
		expect({
			spaced: countProtectedLeadingLines(['#| label: a', 'x = 1'], '#'),
			noSpaceAfterPipe: countProtectedLeadingLines(['#|label: a', 'x = 1'], '#'),
			spaceBeforePipe: countProtectedLeadingLines(['# | label: a', 'x = 1'], '#'),
			severalThenCode: countProtectedLeadingLines(
				['#| label: a', '#| echo: false', 'x = 1'], '#'),
			// An empty line ends the run, as it does in the extension: the count
			// stops at the first line that does not match, whatever it is.
			blankLineStops: countProtectedLeadingLines(
				['#| label: a', '', '#| echo: false'], '#'),
			allOptionLines: countProtectedLeadingLines(['#| label: a', '#| echo: false'], '#'),
			noOptionLines: countProtectedLeadingLines(['x = 1', 'y = 2'], '#'),
			empty: countProtectedLeadingLines([], '#'),
		}).toMatchInlineSnapshot(`
			{
			  "allOptionLines": 2,
			  "blankLineStops": 1,
			  "empty": 0,
			  "noOptionLines": 0,
			  "noSpaceAfterPipe": 1,
			  "severalThenCode": 2,
			  "spaceBeforePipe": 1,
			  "spaced": 1,
			}
		`);
	});

	it('does not count an indented option line, which is not one to Quarto either', () => {
		// The pattern is anchored at column 0, so Quarto does not read this as a
		// cell option and neither do we. It matters because ruff dedents such a
		// line, and that edit must not be treated as touching a protected line.
		expect(countProtectedLeadingLines(['  #| label: a', 'x = 1'], '#')).toBe(0);
	});

	it('takes the comment token from the language, and only counts leading lines', () => {
		expect({
			doubleSlash: countProtectedLeadingLines(['//| label: a', 'const x = 1;'], '//'),
			hashDoesNotMatchSlashLanguage: countProtectedLeadingLines(['#| label: a'], '//'),
			// No language configuration: `#` is the default in `langCommentChars`.
			fallsBackToHash: countProtectedLeadingLines(['#| label: a', 'x = 1'], undefined),
			// Below code, so not leading, so not protected.
			belowCode: countProtectedLeadingLines(['x = 1', '#| label: a'], '#'),
		}).toEqual({
			doubleSlash: 1,
			hashDoesNotMatchSlashLanguage: 0,
			fallsBackToHash: 1,
			belowCode: 0,
		});
	});
});

describe('editsWithinCell', () => {
	it('accepts an edit ending on the last line and rejects one past it', () => {
		expect({
			onLastLine: editsWithinCell([edit(3, 1, 3, 6, 'x = 1')], 3),
			pastLastLine: editsWithinCell([edit(3, 1, 4, 1, 'x = 1')], 3),
			// A span with no lines at all, which is what an empty chunk gives.
			emptyCell: editsWithinCell([edit(1, 1, 1, 1, 'x')], 0),
		}).toEqual({ onLastLine: true, pastLastLine: false, emptyCell: false });
	});

	it('rejects an edit that starts before the beginning of the cell', () => {
		// The lower bound is what stops a zero range reaching `cellRangeToSource`,
		// whose answer would carry column zero. The extension host throws on that
		// rather than dropping the edit, which would fail the whole format.
		expect({
			lineZero: editsWithinCell([edit(0, 1, 1, 1, 'x')], 3),
			columnZero: editsWithinCell([edit(1, 0, 1, 1, 'x')], 3),
			zeroRange: editsWithinCell([edit(0, 0, 0, 0, '')], 3),
		}).toEqual({ lineZero: false, columnZero: false, zeroRange: false });
	});
});

describe('withoutNoOpEdits', () => {
	it('drops the editor worker\'s end-of-line sentinel and keeps real edits', () => {
		// `EditorWorker.$computeMoreMinimalEdits` appends exactly this whenever an
		// incoming edit carried `eol`. The line ending belongs to the source
		// document rather than to a cell, so what is left changes nothing.
		const sentinel: TextEdit = { ...edit(0, 0, 0, 0, ''), eol: 1 };

		expect(shapes(withoutNoOpEdits([edit(1, 1, 1, 8, 'x = 1'), sentinel])))
			.toEqual(['(1,1)-(1,8) -> "x = 1"']);
	});

	it('keeps a deletion, which has no text but does have a range', () => {
		expect(shapes(withoutNoOpEdits([edit(1, 1, 2, 1, '')])))
			.toEqual(['(1,1)-(2,1) -> ""']);
	});
});

describe('withoutTrailingNewlineAtCellEnd', () => {
	// A cell whose last line is line 3, `print(y)`, so its end is (3, 9).
	const lastLineNumber = 3;
	const lastLineMaxColumn = 9;

	it('drops a newline-only insertion at the end of the cell', () => {
		// air's real answer for a cell that only lacks a final newline.
		expect(shapes(withoutTrailingNewlineAtCellEnd(
			[edit(3, 9, 3, 9, '\n')], lastLineNumber, lastLineMaxColumn))).toEqual([]);
	});

	it('keeps the code of a replacement that ends the cell, and trims its trailing newline', () => {
		// ruff's real answer: the newline arrives inside a replacement that also
		// reformats code, so a rule matching only pure insertions would forward
		// it and grow the chunk by a blank line on every format.
		expect(shapes(withoutTrailingNewlineAtCellEnd(
			[edit(2, 1, 3, 9, 'y = 1\nprint(y)\n')], lastLineNumber, lastLineMaxColumn)))
			.toEqual(['(2,1)-(3,9) -> "y = 1\\nprint(y)"']);
	});

	it('leaves newlines alone when they are not at the end of the cell', () => {
		expect(shapes(withoutTrailingNewlineAtCellEnd([
			// Mid-cell insertion of a blank line: a real formatting decision.
			edit(2, 1, 2, 1, '\n'),
			// At the end of the cell, but carrying content, so not an artifact.
			edit(3, 9, 3, 9, '\nz = 2'),
		], lastLineNumber, lastLineMaxColumn))).toEqual([
			'(2,1)-(2,1) -> "\\n"',
			'(3,9)-(3,9) -> "\\nz = 2"',
		]);
	});

	it('trims a CRLF ending as well', () => {
		expect(shapes(withoutTrailingNewlineAtCellEnd(
			[edit(3, 1, 3, 9, 'print(y)\r\n')], lastLineNumber, lastLineMaxColumn)))
			.toEqual(['(3,1)-(3,9) -> "print(y)"']);
	});
});

describe('resolveProtectedLineEdits', () => {
	// Two option lines, a blank line, then two lines of code.
	const cellText = '#| label: a\n#| echo: false\n\nx  =  1\nprint( x )';

	it('returns the edits untouched when the cell has no option lines', () => {
		const edits = [edit(1, 1, 1, 8, 'x = 1')];
		expect(resolveProtectedLineEdits('x  =  1', edits, '#')).toBe(edits);
	});

	it('forwards every edit when they all sit below the option block', () => {
		expect(shapes(resolveProtectedLineEdits(cellText, [
			edit(4, 1, 4, 8, 'x = 1'),
			edit(5, 1, 5, 11, 'print(x)'),
		], '#'))).toEqual([
			'(4,1)-(4,8) -> "x = 1"',
			'(5,1)-(5,11) -> "print(x)"',
		]);
	});

	it('drops in-place option-line rewrites and keeps the code edits', () => {
		// The posit-dev/positron#9432 shape: a formatter that normalizes `#|` to
		// `# |` while also reformatting the code below. Dropping the two
		// normalizations restores the option lines byte for byte, so the code
		// edits are safe to forward.
		expect(shapes(resolveProtectedLineEdits(cellText, [
			edit(1, 2, 1, 2, ' '),
			edit(2, 2, 2, 2, ' '),
			edit(4, 1, 4, 8, 'x = 1'),
		], '#'))).toEqual(['(4,1)-(4,8) -> "x = 1"']);
	});

	it('vetoes an edit that deletes an option line', () => {
		// Reaches from the start of the last option line into the line below it,
		// so there is nothing wholly inside the block to drop and no way to save
		// the line.
		expect(resolveProtectedLineEdits(
			cellText, [edit(2, 1, 3, 1, '')], '#')).toBeUndefined();
	});

	it('vetoes an edit that merges an option line into the code below', () => {
		expect(resolveProtectedLineEdits(
			cellText, [edit(2, 15, 4, 1, ' ')], '#')).toBeUndefined();
	});

	it('vetoes an in-block edit that changes the line count instead of dropping it', () => {
		// A formatter moving an option line below the code: a deletion wholly
		// inside the block, plus the reinsertion under it. Dropping the deletion
		// on its own would leave the option lines byte-identical and forward the
		// insertion, so the line would appear twice. Line count is what separates
		// a move from an in-place rewrite, so this vetoes instead.
		expect(resolveProtectedLineEdits(cellText, [
			edit(1, 1, 2, 1, ''),
			edit(4, 1, 4, 1, '#| label: a\n'),
		], '#')).toBeUndefined();
	});

	it('forwards a straddling edit that leaves the option lines byte-identical', () => {
		// Reaches from inside the block to below it, but rewrites only what comes
		// after. Verifying the outcome forwards this; vetoing on geometry alone
		// would have rejected it.
		expect(shapes(resolveProtectedLineEdits(cellText, [
			edit(2, 15, 4, 8, '\n\nx = 1'),
		], '#'))).toEqual(['(2,15)-(4,8) -> "\\n\\nx = 1"']);
	});

	it('vetoes an edit that promotes the line below the block into an option', () => {
		// ruff dedents an indented comment, and an indented `#|` is not an option
		// line to Quarto. Dedenting one that sits directly under the block adds a
		// directive to the cell, which changes how the chunk executes, while the
		// block's own lines come through untouched.
		const withIndentedDirective = '#| label: a\n  #| echo: false\nx = 1';

		expect(resolveProtectedLineEdits(
			withIndentedDirective, [edit(2, 1, 2, 3, '')], '#')).toBeUndefined();
	});

	it('vetoes an edit that promotes the first line of a cell that had no block', () => {
		// The same hazard with nothing to protect yet: the dedent gives the chunk
		// its first option line.
		expect(resolveProtectedLineEdits(
			'  #| echo: false\nx = 1', [edit(1, 1, 1, 3, '')], '#')).toBeUndefined();
	});

	it('forwards an edit that leaves an indented directive further down alone', () => {
		// Only the line directly below the block can join it, so a dedent deeper
		// in the cell is an ordinary comment change.
		const edits = [edit(3, 1, 3, 3, '')];
		expect(shapes(resolveProtectedLineEdits(
			'#| label: a\nx = 1\n  #| not an option\n', edits, '#')))
			.toEqual(['(3,1)-(3,3) -> ""']);
	});

	it('vetoes overlapping edits even when there are no option lines to protect', () => {
		// The early return for zero protected lines still has to confirm the
		// answer can be applied at all.
		expect(resolveProtectedLineEdits('x  =  1\nprint( x )', [
			edit(1, 1, 1, 8, 'x = 1'),
			edit(1, 3, 2, 11, 'nonsense'),
		], '#')).toBeUndefined();
	});

	it('vetoes overlapping edits rather than throwing', () => {
		// Core's edit machinery rejects replacements that overlap, and a
		// misbehaving provider is not a reason to lose the whole format.
		expect(resolveProtectedLineEdits(cellText, [
			edit(4, 1, 4, 8, 'x = 1'),
			edit(4, 3, 5, 11, 'nonsense'),
		], '#')).toBeUndefined();
	});
});
