/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Reading what the text immediately before the cursor says about what is being completed.
 *
 * Deliberately a scan of the raw text rather than anything the parser produced. Completion is
 * asked for while the user is midway through typing an identifier, which is the one state the
 * tokenizer cannot always be run on: a half typed `"Order T` has no closing quote, so it would
 * swallow the rest of the document. The few characters before the cursor say everything that is
 * needed -- the partial name, the dotted qualifiers in front of it, and whether the cursor is
 * somewhere no identifier belongs at all.
 */

/** Characters that may appear in a bare identifier. */
const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/;

/** Closing quote to opening quote, for reading a quoted identifier backwards from the cursor. */
const CLOSING_QUOTES = new Map([['"', '"'], ['`', '`'], [']', '[']]);

/**
 * Opening quote to closing quote, for the identifier forms the common dialects use: standard SQL
 * and PostgreSQL double quotes, MySQL backticks, T-SQL brackets. Accepting all three whatever the
 * dialect costs nothing here -- a dialect that does not use a form will not have produced one.
 */
const IDENTIFIER_QUOTES = new Map([['"', '"'], ['`', '`'], ['[', ']']]);

/** Stands in for the identifier being typed, so the text around it can be tokenized. */
export const PLACEHOLDER = '__positron_sql_cursor__';

export interface Cursor {
	/** The partial identifier under the cursor, possibly empty. */
	readonly prefix: string;

	/** Where the partial identifier starts, and so what a matching completion is filtered by. */
	readonly prefixStart: number;

	/**
	 * Where a completion's edit should start.
	 *
	 * The same as {@link prefixStart} except inside a half typed quoted identifier, where it is
	 * the opening quote. A completion that needs quoting inserts them itself, so an edit starting
	 * after the quote would turn `o."Order T` into `o.""Order Total"`.
	 */
	readonly replaceStart: number;

	/**
	 * Where a completion's edit should end: the cursor, or just past it inside a quote the editor
	 * closed as it was opened, `"Order T|"`. Every completion brings its own closing quote, so the
	 * one already there would otherwise be left dangling after it.
	 */
	readonly replaceEnd: number;

	/**
	 * The dotted names in front of the prefix, outermost first: `sales.orders.` gives
	 * `['sales', 'orders']`. Empty when the cursor is not after a dot.
	 */
	readonly qualifiers: readonly string[];

	/**
	 * Set when the cursor is somewhere no identifier belongs -- inside a string literal, a comment
	 * or a dollar quoted body -- and the request should produce nothing at all.
	 */
	readonly suppressed: boolean;

	/** Whether the partial identifier began with an opening quote. */
	readonly quoted: boolean;
}

/**
 * Finds the quote or comment the cursor sits inside, if any.
 *
 * Returns the opening delimiter and the offset just past it, or undefined when the cursor is in
 * ordinary code. Scanned from the start of the document, because a string literal, a block
 * comment and a dollar quoted body can all span lines, and what one of them opened three lines up
 * is still open at the cursor.
 *
 * What never closes is closed the way the analyzer's tokenizer closes it, so the two agree about
 * what is code: a quote that closes nowhere in the rest of the document ends at its own line --
 * far more likely a typo than an intent to quote everything below it -- while an unclosed block
 * comment or dollar quote runs to the end. A quoted identifier never spans lines, which is what
 * makes `"Order T` the half typed name it looks like rather than the start of one that swallows
 * the rest of the file.
 */
function openQuoteAt(text: string, offset: number): { delimiter: string; contentStart: number } | undefined {
	let position = 0;

	while (position < offset) {
		const char = text[position];

		if (char === '-' && text.startsWith('--', position)) {
			const end = lineEnd(text, position);
			if (end >= offset) {
				return { delimiter: '--', contentStart: position + 2 };
			}
			position = end;
			continue;
		}

		if (char === '/' && text.startsWith('/*', position)) {
			const close = text.indexOf('*/', position + 2);
			if (close < 0 || close + 2 > offset) {
				return { delimiter: '/*', contentStart: position + 2 };
			}
			position = close + 2;
			continue;
		}

		if (char === '\'') {
			const close = closingQuote(text, position);
			// Closed nowhere in the document: a typo, taken to end with its line.
			const end = close < 0 ? lineEnd(text, position) : close + 1;
			if (end > offset || (close < 0 && end >= offset)) {
				return { delimiter: '\'', contentStart: position + 1 };
			}
			position = end;
			continue;
		}

		if (char === '$') {
			const tag = dollarTag(text, position);
			if (tag) {
				const close = text.indexOf(tag, position + tag.length);
				if (close < 0 || close + tag.length > offset) {
					return { delimiter: tag, contentStart: position + tag.length };
				}
				position = close + tag.length;
				continue;
			}
		}

		const closing = IDENTIFIER_QUOTES.get(char);
		if (closing !== undefined) {
			const end = text.indexOf(closing, position + 1);
			const lineStop = lineEnd(text, position);
			if (end < 0 || end > lineStop) {
				// Never closed on its line, so it ends there.
				if (lineStop >= offset) {
					return { delimiter: char, contentStart: position + 1 };
				}
				position = lineStop;
				continue;
			}
			if (end >= offset) {
				return { delimiter: char, contentStart: position + 1 };
			}
			position = end + 1;
			continue;
		}

		position += 1;
	}

	return undefined;
}

/** The offset of the line break ending the line `offset` is on, or the end of the text. */
function lineEnd(text: string, offset: number): number {
	const end = text.indexOf('\n', offset);
	return end < 0 ? text.length : end;
}

/** The offset of the quote closing the string literal opened at `open`, or -1 if none does. */
function closingQuote(text: string, open: number): number {
	let position = open + 1;
	while (position < text.length) {
		const close = text.indexOf('\'', position);
		if (close < 0) {
			return -1;
		}
		// A doubled quote is an escaped one and does not close the literal.
		if (text[close + 1] === '\'') {
			position = close + 2;
			continue;
		}
		return close;
	}
	return -1;
}

/**
 * The delimiter of a dollar quoted body opening at `offset` -- `$$` or `$tag$` -- or undefined.
 *
 * Not a parameter (`$1`), whose tag would start with a digit, and not a `$` inside a name, which
 * PostgreSQL allows after its first character.
 */
function dollarTag(text: string, offset: number): string | undefined {
	if (offset > 0 && IDENTIFIER_CHAR.test(text[offset - 1])) {
		return undefined;
	}
	const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(offset, offset + 64));
	return match?.[0];
}

/**
 * Reads the identifier ending at `end`, returning its text and start offset.
 *
 * Handles the quoted forms as well as bare ones, so `"Order Details".` is recognized as a
 * qualifier rather than read as the bare word `Details`.
 */
function readIdentifierBackwards(text: string, end: number): { name: string; start: number } | undefined {
	if (end <= 0) {
		return undefined;
	}

	const opening = CLOSING_QUOTES.get(text[end - 1]);
	if (opening !== undefined) {
		const start = text.lastIndexOf(opening, end - 2);
		if (start < 0) {
			return undefined;
		}
		return { name: text.slice(start + 1, end - 1), start };
	}

	let start = end;
	while (start > 0 && IDENTIFIER_CHAR.test(text[start - 1])) {
		start -= 1;
	}
	return start === end ? undefined : { name: text.slice(start, end), start };
}

/** Reads the partial identifier at the cursor and any dotted qualifiers in front of it. */
export function readCursor(text: string, offset: number): Cursor {
	const openQuote = openQuoteAt(text, offset);
	if (openQuote && !IDENTIFIER_QUOTES.has(openQuote.delimiter)) {
		return {
			prefix: '',
			prefixStart: offset,
			replaceStart: offset,
			replaceEnd: offset,
			qualifiers: [],
			suppressed: true,
			quoted: false,
		};
	}

	let prefixStart: number;
	let quoteStart: number;
	if (openQuote) {
		// Part way through a quoted identifier: everything since the quote is the prefix, and the
		// qualifier scan continues from the quote itself.
		prefixStart = openQuote.contentStart;
		quoteStart = prefixStart - 1;
	} else {
		prefixStart = offset;
		while (prefixStart > 0 && IDENTIFIER_CHAR.test(text[prefixStart - 1])) {
			prefixStart -= 1;
		}
		quoteStart = prefixStart;
	}
	const prefix = text.slice(prefixStart, offset);

	const qualifiers: string[] = [];
	// Walk back over `<identifier> .` pairs. Whitespace around the dots is allowed because it is
	// legal SQL, even if nobody writes it.
	let position = quoteStart;
	let more = true;
	while (more) {
		let scan = position;
		while (scan > 0 && (text[scan - 1] === ' ' || text[scan - 1] === '\t')) {
			scan -= 1;
		}
		if (scan <= 0 || text[scan - 1] !== '.') {
			break;
		}
		scan -= 1;
		while (scan > 0 && (text[scan - 1] === ' ' || text[scan - 1] === '\t')) {
			scan -= 1;
		}
		const identifier = readIdentifierBackwards(text, scan);
		if (identifier) {
			qualifiers.unshift(identifier.name);
			position = identifier.start;
		} else {
			more = false;
		}
	}

	const quoted = openQuote !== undefined;
	const closedAtCursor = quoted && text[offset] === IDENTIFIER_QUOTES.get(openQuote.delimiter);
	return {
		prefix,
		prefixStart,
		replaceStart: quoted ? prefixStart - 1 : prefixStart,
		replaceEnd: closedAtCursor ? offset + 1 : offset,
		qualifiers,
		suppressed: false,
		quoted,
	};
}

/**
 * The document with the identifier being typed swapped for a plain one, and where the cursor
 * moved to.
 *
 * A half typed quoted identifier (`o."Order T`) does not tokenize -- its opening quote swallows
 * the rest of the document -- which would cost the statement it is in its table completions, not
 * just the identifier. Replacing the partial identifier, opening quote included, makes it
 * ordinary SQL again.
 */
export function probeText(text: string, cursor: Cursor): { text: string; offset: number } {
	const start = cursor.replaceStart;
	return {
		// Through the end of the edit rather than the cursor: a closing quote the editor inserted
		// would otherwise open a new quoted identifier after the placeholder.
		text: text.slice(0, start) + PLACEHOLDER + text.slice(cursor.replaceEnd),
		offset: start + PLACEHOLDER.length,
	};
}
