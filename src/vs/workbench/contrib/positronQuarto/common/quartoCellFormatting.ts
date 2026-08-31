/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeRegExpCharacters } from '../../../../base/common/strings.js';
import { Range } from '../../../../editor/common/core/range.js';
import { TextEdit as CoreTextEdit, TextReplacement } from '../../../../editor/common/core/edits/textEdit.js';
import { StringText } from '../../../../editor/common/core/text/abstractText.js';
import { ensureDependenciesAreSet } from '../../../../editor/common/core/text/positionToOffset.js';
import { TextEdit } from '../../../../editor/common/languages.js';

/**
 * The answer of a cell formatting command. Edits are in source coordinates.
 *
 * This is the shape the extension host converter behind
 * `positron.executeQuartoCellFormattingProvider` has to describe, so it lives in
 * `common`: `api/common` cannot import from `positronQuarto/browser`.
 */
export interface IQuartoCellFormattingResult {
	/** Already remapped into source coordinates. Empty when a cell was vetoed. */
	readonly edits: TextEdit[];

	/**
	 * Cells whose formatter answer was rejected. Nonzero means the whole document
	 * format was abandoned, which is what the Quarto extension does today when a
	 * block's edits are out of range.
	 */
	readonly vetoedCells: number;
}

/**
 * How many leading lines of a cell are Quarto option directives.
 *
 * Mirrors `optionCommentPattern` in the Quarto extension, `^<comment>\s*\| ?`,
 * so every spelling Quarto's own cell-option parser accepts is counted here:
 * `#| label`, `#|label`, `# | label`. The count stops at the first line that
 * does not match, including an empty one, which is also where the extension
 * stops.
 *
 * The pattern is anchored, so an indented `#|` is not an option line. Quarto
 * does not read it as one either, which is what makes a formatter free to
 * reindent it.
 */
export function countProtectedLeadingLines(
	cellLines: readonly string[],
	lineCommentToken: string | undefined
): number {
	// `#` is the default in the extension's `langCommentChars`, and the language
	// configuration of a language without line comments gives nothing to match.
	const comment = lineCommentToken || '#';
	const optionPattern = new RegExp(`^${escapeRegExpCharacters(comment)}\\s*\\| ?`);

	let count = 0;
	for (const line of cellLines) {
		if (!optionPattern.test(line)) {
			break;
		}
		count++;
	}
	return count;
}

/**
 * Whether every edit sits inside the cell's own lines.
 *
 * Both bounds are checked, like the sibling `fitsCell` the diagnostics path
 * uses. An answer reaching past the end of the cell would land on the closing
 * fence or in the prose below it once mapped, and one starting before the
 * beginning would map to a column of zero, which the extension host rejects
 * outright when it converts the range.
 *
 * `cellLineCount` is the number of lines the cell's **span** holds, not the
 * line count of its text model. They differ for a chunk with no code, whose
 * fences are on consecutive lines: the span holds no lines while the model
 * still has one.
 */
export function editsWithinCell(edits: readonly TextEdit[], cellLineCount: number): boolean {
	return edits.every(edit =>
		edit.range.startLineNumber >= 1
		&& edit.range.startColumn >= 1
		&& edit.range.endLineNumber <= cellLineCount);
}

/**
 * Edits that would change nothing removed.
 *
 * The editor worker appends one of these to every minimized answer whose input
 * carried an end-of-line change: `{ eol, text: '', range: 0,0,0,0 }`
 * (`EditorWorker.$computeMoreMinimalEdits`). The line ending is not ours to
 * forward, since it belongs to the whole source document rather than to one
 * cell, so what is left is an edit with no text and no range. Dropping it here
 * rather than letting the bounds check see it matters: its zero range would
 * otherwise veto the document format of anyone whose formatter sets an
 * end-of-line, and the veto would be for an edit that does nothing.
 */
export function withoutNoOpEdits(edits: readonly TextEdit[]): TextEdit[] {
	return edits.filter(
		edit => edit.text.length > 0 || !Range.lift(edit.range).isEmpty());
}

/**
 * Edits with any newline they would leave at the very end of the cell removed.
 *
 * A cell's text model carries no trailing newline, because the closing fence
 * supplies that break in the source document. A formatter that believes it is
 * looking at a file adds one, and mapped back that grows the chunk by a blank
 * line on every single format.
 *
 * This is an invariant rather than a shape match, because the newline usually
 * arrives inside a replacement that also reformats code: ruff answers a dirty
 * cell with one replacement ending `'x = 1\nprint(x)\n'`, and air with a
 * replacement ending `'x)\n'`. Only when the trim empties a pure insertion is
 * the edit dropped altogether.
 */
export function withoutTrailingNewlineAtCellEnd(
	edits: readonly TextEdit[],
	lastLineNumber: number,
	lastLineMaxColumn: number
): TextEdit[] {
	const kept: TextEdit[] = [];

	for (const edit of edits) {
		const endsCell = edit.range.endLineNumber === lastLineNumber
			&& edit.range.endColumn === lastLineMaxColumn;
		if (!endsCell) {
			kept.push(edit);
			continue;
		}

		const trimmed = edit.text.replace(/(\r?\n)+$/, '');
		if (trimmed.length === 0 && Range.lift(edit.range).isEmpty()) {
			// Nothing but the newline, and nothing replaced: an artifact.
			continue;
		}
		kept.push(trimmed === edit.text ? edit : { ...edit, text: trimmed });
	}

	return kept;
}

/** The first `count` lines of a text, as one string. */
function firstLines(text: string, count: number): string {
	return text.split('\n').slice(0, count).join('\n');
}

/** Lines a range covers, and lines a replacement text occupies. */
function spannedLineCount(edit: TextEdit): number {
	return edit.range.endLineNumber - edit.range.startLineNumber + 1;
}

function textLineCount(text: string): number {
	return text.split('\n').length;
}

/**
 * Apply edits to a text, or answer `undefined` if they cannot be applied.
 *
 * Overlap is tested here rather than left to core, whose constructor reports an
 * overlap through `assertFn`. That may only log, which would leave a garbled
 * string looking like a successful application.
 */
function tryApply(text: string, edits: readonly TextEdit[]): string | undefined {
	const ranges = edits.map(edit => Range.lift(edit.range))
		.sort(Range.compareRangesUsingStarts);
	for (let index = 1; index < ranges.length; index++) {
		if (!ranges[index - 1].getEndPosition().isBeforeOrEqual(ranges[index].getStartPosition())) {
			return undefined;
		}
	}

	// `StringText` reaches the position transformer, whose dependencies are wired
	// by a module nothing in this import chain pulls in. Upstream exposes this
	// call for that, and the diff computer and the editor worker both make it
	// before using the same machinery. It is a noop after the first call.
	ensureDependenciesAreSet();

	try {
		const replacements = edits.map(
			edit => new TextReplacement(Range.lift(edit.range), edit.text));
		return CoreTextEdit.fromParallelReplacementsUnsorted(replacements)
			.apply(new StringText(text));
	} catch (error) {
		// An out-of-bounds range, which a provider should not send and which is
		// not worth losing the rest of the document's format over.
		return undefined;
	}
}

/**
 * Whether the cell's leading option block came through the edits intact.
 *
 * Two things have to hold. The block's own lines must be byte-identical, and no
 * new directive may have appeared directly below it: Quarto reads a contiguous
 * run from the top of the cell, so a formatter that promotes the next line into
 * the run silently gives the chunk another option. Only growth is possible once
 * the lines above are known identical, so comparing the counts catches it.
 *
 * The promotion is not hypothetical. ruff dedents an indented comment, and an
 * indented `#|` is not an option line to Quarto, so `  #| echo: false` sitting
 * under the block becomes `#| echo: false` and starts taking effect.
 */
function protectedBlockSurvives(
	before: string,
	after: string,
	protectedLineCount: number,
	lineCommentToken: string | undefined
): boolean {
	if (firstLines(after, protectedLineCount) !== firstLines(before, protectedLineCount)) {
		return false;
	}
	return countProtectedLeadingLines(after.split('\n'), lineCommentToken) === protectedLineCount;
}

/**
 * The edits that may be forwarded without changing the cell's leading option
 * lines, decided by applying them rather than by inspecting their ranges.
 *
 * Three outcomes, in order:
 *
 * 1. The option block survives the whole edit list, so everything is forwarded.
 *    This is what well-behaved formatters produce; ruff 0.16 and air both leave
 *    `#|` lines alone.
 * 2. It does not, but dropping the edits wholly inside the block saves it. Those
 *    dropped edits must not change the block's line count: an in-place rewrite of
 *    an option line can be dropped on its own, while a deletion is half of a move
 *    whose other half would then duplicate the line. This is the
 *    posit-dev/positron#9432 case, where a formatter normalizes `#|` to `# |`
 *    while reformatting the code below it.
 * 3. Neither, so the caller vetoes the cell. Geometry is never trusted on its
 *    own, because quarto-dev/quarto#655 showed that filtering edits by range can
 *    keep one half of a pair that only makes sense together.
 *
 * The option lines are counted here rather than passed in, so the count and the
 * text they were counted from cannot disagree.
 */
export function resolveProtectedLineEdits(
	cellText: string,
	edits: readonly TextEdit[],
	lineCommentToken: string | undefined
): readonly TextEdit[] | undefined {
	const protectedLineCount = countProtectedLeadingLines(cellText.split('\n'), lineCommentToken);

	// Applied even when the cell has no option lines at all. That case still has
	// to confirm the edits are applicable, since overlap is what core may only
	// log rather than reject, and that a directive has not appeared at the top.
	const applied = tryApply(cellText, edits);
	if (applied !== undefined
		&& protectedBlockSurvives(cellText, applied, protectedLineCount, lineCommentToken)) {
		return edits;
	}

	if (protectedLineCount === 0) {
		// No block, so nothing sits wholly inside one, so there is nothing to drop
		// and nothing further to try.
		return undefined;
	}

	const kept: TextEdit[] = [];
	let dropped = 0;
	for (const edit of edits) {
		if (edit.range.endLineNumber > protectedLineCount) {
			kept.push(edit);
			continue;
		}
		if (textLineCount(edit.text) !== spannedLineCount(edit)) {
			// Adds or removes a line inside the block, so it cannot be an
			// in-place rewrite, and dropping it would forward the rest of a move.
			return undefined;
		}
		dropped++;
	}

	if (dropped === 0) {
		// Nothing to drop, so nothing left to try.
		return undefined;
	}

	const reapplied = tryApply(cellText, kept);
	if (reapplied === undefined
		|| !protectedBlockSurvives(cellText, reapplied, protectedLineCount, lineCommentToken)) {
		return undefined;
	}
	return kept;
}
