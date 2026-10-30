/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A hyperlink found in a string of text.
 */
export interface HyperlinkMatch {
	/** The text of the hyperlink. */
	readonly text: string;

	/** The index of the hyperlink in the searched text. */
	readonly index: number;
}

/**
 *
 * Detects hyperlinks in a string of text.
 *
 * Note that this function uses a simple regex that ignores characters that
 * typically delimit a hyperlink, such as quotes, parentheses, and braces, even
 * though these characters are technically allowed in a URL.
 *
 * @param text The text to search for hyperlinks.
 * @returns An array of hyperlinks found in the text, in order, if any.
 */
export function detectHyperlinks(text: string): Array<HyperlinkMatch> {
	return Array.from(
		text.matchAll(/\bhttps?:\/\/[^'">)}\s]+/g),
		match => ({ text: match[0], index: match.index })
	);
}
