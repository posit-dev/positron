/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';

/**
 * A position in a document.
 *
 * Unlike VS Code's Position which uses UTF-16 code units for the character
 * offset, this interface uses UTF-8 byte offsets. This is necessary to
 * losslessly communicate line offsets to backends. When provided a code subset
 * (e.g. selection) with a location whose range start has a character/column
 * offset, the backends do not have access to original line, without which
 * UTF-16 code units or Unicode points are meaningless.
 */
export interface ICodePosition {
	/** 0-based line number */
	readonly line: number;
	/** 0-based column offset in UTF-8 bytes */
	readonly character: number;
}

/**
 * A range in a document using UTF-8 byte offsets for character positions.
 */
export interface ICodeRange {
	readonly start: ICodePosition;
	readonly end: ICodePosition;
}

/**
 * A location in a document using UTF-8 byte offsets for character positions.
 */
export interface ICodeLocation {
	readonly uri: URI;
	readonly range: ICodeRange;
}

/**
 * Computes the UTF-8 byte offset from a UTF-16 code unit offset within a line of text.
 *
 * @param lineText The full text of the line
 * @param utf16Offset The UTF-16 code unit offset (0-based)
 * @returns The UTF-8 byte offset
 */
export function utf8ByteOffsetFromUtf16(lineText: string, utf16Offset: number): number {
	const prefix = lineText.slice(0, utf16Offset);
	return new TextEncoder().encode(prefix).length;
}

/**
 * Derives the code location of a fragment carved out of a larger piece of code,
 * given the location of the whole and the fragment's line range within it.
 *
 * When submitted code is split into per-statement fragments by an input
 * boundary provider, each fragment must carry its own source attribution so the
 * runtime can map it back to the correct source lines (e.g. so a language
 * runtime can verify a breakpoint against the statement that actually contains
 * it). Splitting alone would leave every fragment pointing at the whole
 * selection's location. This offsets that location by the fragment's starting
 * line so each fragment is attributed to the lines it actually came from.
 *
 * Boundaries are line ranges, so a fragment always begins at the start of a
 * source line except for the very first line of the whole code, which inherits
 * the whole code's starting column (a selection can begin mid-line).
 *
 * @param whole The code location of the entire submitted code.
 * @param fragmentCode The fragment's text (its lines joined with `\n`).
 * @param startLine The fragment's 0-based start line within the submitted code.
 * @param endLine The fragment's 0-based end line (exclusive) within the code.
 * @returns A code location describing the fragment's position in the source.
 */
export function fragmentCodeLocation(
	whole: ICodeLocation,
	fragmentCode: string,
	startLine: number,
	endLine: number
): ICodeLocation {
	const wholeStart = whole.range.start;

	// The fragment's last line, as a 0-based line offset within the submitted
	// code. `endLine` is exclusive, so the last line is `endLine - 1`; clamp to
	// `startLine` defensively in case of an empty range.
	const lastLine = Math.max(endLine - 1, startLine);

	// Only the very first line of the whole code is offset by the whole code's
	// starting column; every subsequent source line begins at column 0.
	const startCharacter = startLine === 0 ? wholeStart.character : 0;
	const endBaseCharacter = lastLine === 0 ? wholeStart.character : 0;

	// The fragment's last line's byte length gives the end column.
	const fragmentLines = fragmentCode.split('\n');
	const lastLineText = fragmentLines[fragmentLines.length - 1];
	const endCharacter = endBaseCharacter + utf8ByteOffsetFromUtf16(lastLineText, lastLineText.length);

	return {
		uri: whole.uri,
		range: {
			start: { line: wholeStart.line + startLine, character: startCharacter },
			end: { line: wholeStart.line + lastLine, character: endCharacter },
		},
	};
}

/**
 * Creates a code location with UTF-8 byte offsets from a text model and a VS Code range.
 *
 * This should be called at the source where the model is available, as the conversion
 * from UTF-16 to UTF-8 offsets requires access to the actual line text.
 *
 * @param model The text model
 * @param uri The document URI
 * @param range The range in VS Code coordinates (1-based lines, 1-based UTF-16 columns)
 * @returns A location with 0-based lines and UTF-8 byte offsets for character positions
 */
export function createCodeLocation(
	model: { getLineContent(lineNumber: number): string },
	uri: URI,
	range: IRange
): ICodeLocation {
	const startLineText = model.getLineContent(range.startLineNumber);
	const endLineText = model.getLineContent(range.endLineNumber);

	return {
		uri,
		range: {
			start: {
				line: range.startLineNumber - 1,
				character: utf8ByteOffsetFromUtf16(startLineText, range.startColumn - 1),
			},
			end: {
				line: range.endLineNumber - 1,
				character: utf8ByteOffsetFromUtf16(endLineText, range.endColumn - 1),
			},
		},
	};
}
