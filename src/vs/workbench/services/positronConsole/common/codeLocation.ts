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
