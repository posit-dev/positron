/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Quoting for the compact, line-oriented payloads the data connection commands hand to an agent
 * (see dataConnectionSchemaSummary.ts and positronDataConnectionsCommands.ts). Those payloads trade
 * JSON's per-node keys for size, which makes their delimiters ordinary characters: a table called
 * `a.b`, or a parameter value containing a comma, would otherwise read as two things instead of one.
 * Quoting a token when -- and only when -- it contains a delimiter keeps every line unambiguous
 * while leaving the overwhelmingly common case (an ordinary identifier) untouched.
 *
 * The quoted form is a JSON string literal, so the escaping rules are ones any consumer already
 * knows and every character has a representation.
 * @param text The token to render.
 * @param unsafeCharacters The caller's delimiters, as a plain string of characters. Passed in
 * rather than fixed here because each payload delimits with a different set: a dot separates schema
 * path segments, but appears unquoted in a hostname.
 */
export function quoteCompactToken(text: string, unsafeCharacters: string): string {
	for (const character of text) {
		// A double quote would be mistaken for the start of a quoted token, and a control character
		// (a newline above all) breaks the one-object-per-line contract. Both are unsafe whichever
		// delimiters the caller uses.
		if (character === '"' || character < ' ' || unsafeCharacters.includes(character)) {
			return JSON.stringify(text);
		}
	}
	return text;
}
