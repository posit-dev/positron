/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The code points a consumer may read as a line break that JSON.stringify leaves raw: DEL and the
 * C1 range (NEL among them), plus the U+2028/U+2029 line separators. JSON.stringify escapes the C0
 * controls and the quote, but passes everything above U+007F through as-is, so a token quoted with
 * it alone could still carry a line break into the middle of a line.
 */
const UNESCAPED_LINE_BREAKS = /[\u007f-\u009f\u2028\u2029]/g;

/**
 * Renders a token as a JSON string literal in which no character can be read as a line break, so
 * the one-object-per-line contract holds for every consumer however it splits lines.
 * @param text The token to quote.
 */
function quoteToken(text: string): string {
	return JSON.stringify(text).replace(UNESCAPED_LINE_BREAKS,
		character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Quoting for the compact, line-oriented payloads the data connection commands hand to an agent
 * (see dataConnectionSchemaSummary.ts and positronDataConnectionsCommands.ts). Those payloads trade
 * JSON's per-node keys for size, which makes their delimiters ordinary characters: a table called
 * `a.b`, or a parameter value containing a comma, would otherwise read as two things instead of one.
 * Quoting a token when -- and only when -- it contains a delimiter keeps every line unambiguous
 * while leaving the overwhelmingly common case (an ordinary identifier) untouched.
 *
 * The quoted form is a JSON string literal, so the escaping rules are ones any consumer already
 * knows and every character has a representation -- with the line-breaking code points
 * JSON.stringify passes through unescaped spelled out explicitly; see {@link quoteToken}.
 * @param text The token to render.
 * @param unsafeCharacters The caller's delimiters, as a plain string of characters. Passed in
 * rather than fixed here because each payload delimits with a different set: a dot separates schema
 * path segments, but appears unquoted in a hostname.
 */
export function quoteCompactToken(text: string, unsafeCharacters: string): string {
	// An empty token would otherwise vanish into the surrounding delimiters: an unnamed schema
	// renders its child as `.orders`, and a `name=` field reads as missing. `""` keeps the token
	// visible and the line parseable.
	if (text.length === 0) {
		return '""';
	}
	for (const character of text) {
		// A double quote would be mistaken for the start of a quoted token, and a control character
		// (a newline above all) breaks the one-object-per-line contract. Both are unsafe whichever
		// delimiters the caller uses. Controls beyond C0 count too: DEL, the C1 range (NEL among
		// them), and the U+2028/U+2029 line separators are all line breaks to some consumers.
		if (character === '"'
			|| character < ' '
			|| (character >= '\u007f' && character <= '\u009f')
			|| character === '\u2028'
			|| character === '\u2029'
			|| unsafeCharacters.includes(character)) {
			return quoteToken(text);
		}
	}
	return text;
}

// The characters a bare (unquoted) path segment never contains: a double quote, and every delimiter
// the schema and lineage summaries quote a name for -- their sets combined, less the `.` that
// separates segments.
const BARE_UNSAFE_CHARACTERS = '",:()[]<> ';

/**
 * Splits a dot-joined path in the compact format -- the path a schema summary or lineage line
 * starts with, e.g. `SALES.PUBLIC."Order Details"` -- back into the exact names it was built from:
 * the inverse of joining {@link quoteCompactToken} results with `.`. A segment is either a JSON
 * string literal (a quoted name, which may contain dots, spaces, or anything else) or a bare run
 * of characters up to the next dot.
 *
 * Returns undefined for text that isn't such a path -- an empty segment, a bare segment containing
 * a character the summaries always quote (a space, a bracket, a comma...), an unterminated or
 * malformed quoted segment, or a quoted segment not followed by a dot -- so a caller can report a
 * malformed name rather than act on a guess at what was meant. That catches a whole summary line
 * pasted in place of its path, e.g. `SALES.RAW.ORDERS_LOAD [stage]`.
 * @param text The path to split.
 */
export function parseCompactPath(text: string): string[] | undefined {
	const segments: string[] = [];
	let index = 0;
	while (true) {
		if (text[index] === '"') {
			// Find the closing quote, skipping escaped characters.
			let end = index + 1;
			while (end < text.length && text[end] !== '"') {
				end += text[end] === '\\' ? 2 : 1;
			}
			if (end >= text.length) {
				return undefined;
			}
			try {
				segments.push(JSON.parse(text.slice(index, end + 1)));
			} catch {
				return undefined;
			}
			index = end + 1;
		} else {
			const dot = text.indexOf('.', index);
			const end = dot < 0 ? text.length : dot;
			const segment = text.slice(index, end);
			if (segment.length === 0 || [...segment].some(character => BARE_UNSAFE_CHARACTERS.includes(character) || character < ' ')) {
				return undefined;
			}
			segments.push(segment);
			index = end;
		}

		if (index === text.length) {
			return segments;
		}
		// A segment must be followed by a dot and another segment.
		if (text[index] !== '.' || index + 1 === text.length) {
			return undefined;
		}
		index++;
	}
}
