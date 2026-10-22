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

/**
 * The quote character each dialect writes an identifier with, when it is not the standard one.
 *
 * Keyed by the names the `sql.dialect` setting offers and the connection drivers infer, since
 * those are the only names that reach here. sqlparser's own spellings are listed alongside them:
 * the parser accepts both (see `dialects.rs`), and a reader who knows it by one name should not
 * find the quoting keyed by the other.
 *
 * The one table both sides of completion read: what a completion inserts, and what the text
 * before the cursor is taken to be. A dialect that quotes names with a backtick reads a double
 * quote as a string, and the two would otherwise disagree about `"` the moment one of them was
 * changed.
 */
const DIALECT_QUOTES = new Map([
	// A double quote opens a string in BigQuery, so a name written in one would be a literal.
	['bigquery', '`'],
	['mysql', '`'],
	['mariadb', '`'],
	['hive', '`'],
	['databricks', '`'],
	['spark', '`'],
	['spark2', '`'],
	['sparksql', '`'],
	['tsql', '['],
	['mssql', '['],
]);

/**
 * Dialects whose string literals take a backslash escape, so that `'O\'Brien'` is one string
 * rather than a string followed by `Brien'` opening another. Every backtick dialect, and
 * ClickHouse. A PostgreSQL `E'...'` string does the same, and is recognized by its prefix
 * whatever the dialect.
 */
const BACKSLASH_ESCAPES = new Set([
	...[...DIALECT_QUOTES].filter(([, quote]) => quote === '`').map(([dialect]) => dialect),
	'clickhouse',
]);

/** Dialects where `#` starts a comment that runs to the end of the line, as `--` does. */
const HASH_COMMENTS = new Set(['mysql', 'mariadb', 'bigquery']);

/**
 * The character a dialect opens a quoted identifier with.
 * @param dialect The dialect, as the `sql.dialect` setting names it; `''` for the generic one.
 */
export function identifierQuote(dialect: string): string {
	return DIALECT_QUOTES.get(dialect) ?? '"';
}

/**
 * Dialects that write a name in brackets, `[Order Details]`. Everywhere else a bracket is a list,
 * an array or a subscript -- DuckDB's `[1, 2]`, PostgreSQL's `ARRAY[...]` and `tags[1]` -- and
 * reading one as a quote would leave the cursor inside a name it is not in.
 */
const BRACKET_NAMES = new Set(['tsql', 'mssql', 'sqlite']);

/**
 * Opening quote to closing quote, for the identifier forms the common dialects use: standard SQL
 * and PostgreSQL double quotes, MySQL backticks, and, where the dialect has them, T-SQL brackets.
 * Double quotes and backticks are accepted whatever the dialect -- one that does not use a form
 * will not have produced one -- except for a double quote where it opens a string, which is read
 * as one first.
 */
function identifierQuotes(lexicon: Lexicon): ReadonlyMap<string, string> {
	return lexicon.brackets ? BRACKETED_QUOTES : PLAIN_QUOTES;
}
const PLAIN_QUOTES = new Map([['"', '"'], ['`', '`']]);
const BRACKETED_QUOTES = new Map([...PLAIN_QUOTES, ['[', ']']]);

/** How a dialect writes the strings and comments the cursor can be inside. */
interface Lexicon {
	/** The characters that open a string literal: always `'`, and `"` where it is not a name. */
	readonly strings: string;
	/** Whether a backslash escapes the next character of any string. */
	readonly backslash: boolean;
	/** Whether `#` starts a line comment. */
	readonly hashComments: boolean;
	/** Whether a bracket quotes a name; see {@link BRACKET_NAMES}. */
	readonly brackets: boolean;
}

function lexiconOf(dialect: string): Lexicon {
	return {
		strings: identifierQuote(dialect) === '`' ? '\'"' : '\'',
		backslash: BACKSLASH_ESCAPES.has(dialect),
		hashComments: HASH_COMMENTS.has(dialect),
		brackets: BRACKET_NAMES.has(dialect),
	};
}

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
	 * Where a completion inserted in front of the rest of the word should end: the cursor, or past
	 * the closing quote of a quoted identifier the cursor is inside, `"Order T|"`. Every completion
	 * brings its own closing quote, so the one already there would otherwise be left dangling after
	 * it -- and a quoted name is replaced whole, since inserting in the middle of one leaves its
	 * tail inside the quotes of the name that went in.
	 */
	readonly replaceEnd: number;

	/**
	 * Where a completion that replaces the word under the cursor should end: past the rest of a
	 * bare word, `o.cu|st`, so that the editor's replace mode turns it into `o.customer_id` rather
	 * than `o.customer_idst`. The same as {@link replaceEnd} anywhere else.
	 */
	readonly wordEnd: number;

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
/**
 * What the cursor sits inside: its opening delimiter, the offset just past it, and for a quoted
 * identifier closed later on the line, the offset of its closing quote.
 */
interface OpenQuote {
	readonly delimiter: string;
	readonly contentStart: number;
	/** Whether it is a quoted identifier, rather than a string, a comment or a dollar quoted body. */
	readonly identifier: boolean;
	readonly close?: number;
}

function openQuoteAt(
	text: string,
	offset: number,
	lexicon: Lexicon,
): OpenQuote | undefined {
	let position = 0;

	while (position < offset) {
		const char = text[position];

		if ((char === '-' && text.startsWith('--', position)) || (char === '#' && lexicon.hashComments)) {
			const end = lineEnd(text, position);
			if (end >= offset) {
				return { delimiter: char, contentStart: position + (char === '#' ? 1 : 2), identifier: false };
			}
			position = end;
			continue;
		}

		if (char === '/' && text.startsWith('/*', position)) {
			const close = text.indexOf('*/', position + 2);
			if (close < 0 || close + 2 > offset) {
				return { delimiter: '/*', contentStart: position + 2, identifier: false };
			}
			position = close + 2;
			continue;
		}

		if (lexicon.strings.includes(char)) {
			// `E'...'` takes backslash escapes in PostgreSQL whatever else the dialect does, and is
			// an error rather than something else in the dialects that do not have it.
			const escaped = lexicon.backslash
				|| (char === '\'' && /[Ee]/.test(text[position - 1] ?? '') && !IDENTIFIER_CHAR.test(text[position - 2] ?? ''));
			const close = closingQuote(text, position, escaped);
			// Closed nowhere in the document: a typo, taken to end with its line.
			const end = close < 0 ? lineEnd(text, position) : close + 1;
			if (end > offset || (close < 0 && end >= offset)) {
				return { delimiter: char, contentStart: position + 1, identifier: false };
			}
			position = end;
			continue;
		}

		if (char === '$') {
			const tag = dollarTag(text, position);
			if (tag) {
				const close = text.indexOf(tag, position + tag.length);
				if (close < 0 || close + tag.length > offset) {
					return { delimiter: tag, contentStart: position + tag.length, identifier: false };
				}
				position = close + tag.length;
				continue;
			}
		}

		const closing = identifierQuotes(lexicon).get(char);
		if (closing !== undefined) {
			const end = text.indexOf(closing, position + 1);
			const lineStop = lineEnd(text, position);
			if (end < 0 || end > lineStop) {
				// Never closed on its line, so it ends there.
				if (lineStop >= offset) {
					return { delimiter: char, contentStart: position + 1, identifier: true };
				}
				position = lineStop;
				continue;
			}
			if (end >= offset) {
				return { delimiter: char, contentStart: position + 1, identifier: true, close: end };
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

/**
 * The offset of the quote closing the string literal opened at `open`, or -1 if none does.
 * @param backslash Whether a backslash escapes the character after it, as well as a doubled quote.
 */
function closingQuote(text: string, open: number, backslash: boolean): number {
	const quote = text[open];
	let position = open + 1;
	while (position < text.length) {
		const close = text.indexOf(quote, position);
		if (close < 0) {
			return -1;
		}
		if (backslash) {
			const slash = text.indexOf('\\', position);
			if (slash >= 0 && slash < close) {
				position = slash + 2;
				continue;
			}
		}
		// A doubled quote is an escaped one and does not close the literal.
		if (text[close + 1] === quote) {
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
function readIdentifierBackwards(
	text: string,
	end: number,
	lexicon: Lexicon,
): { name: string; start: number } | undefined {
	if (end <= 0) {
		return undefined;
	}

	const closing = text[end - 1];
	const opening = [...identifierQuotes(lexicon)].find(([, close]) => close === closing)?.[0];
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
/**
 * @param dialect The dialect to read strings and comments by, as the `sql.dialect` setting names
 *   it: whether `"` opens a name or a string, whether a backslash escapes a quote, and whether `#`
 *   starts a comment. `''` for the generic dialect.
 */
export function readCursor(text: string, offset: number, dialect = ''): Cursor {
	const lexicon = lexiconOf(dialect);
	const openQuote = openQuoteAt(text, offset, lexicon);
	if (openQuote && !openQuote.identifier) {
		return {
			prefix: '',
			prefixStart: offset,
			replaceStart: offset,
			replaceEnd: offset,
			wordEnd: offset,
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
		const identifier = readIdentifierBackwards(text, scan, lexicon);
		if (identifier) {
			qualifiers.unshift(identifier.name);
			position = identifier.start;
		} else {
			more = false;
		}
	}

	const quoted = openQuote !== undefined;
	let replaceEnd = offset;
	let wordEnd = offset;
	if (openQuote?.close !== undefined && !/^\s/.test(text.slice(offset, openQuote.close))) {
		// Inside a quoted name that closes later on the line, the whole name is replaced. Unless
		// what follows the cursor starts with a space: `"| FROM "orders"` is far likelier a quote
		// just typed, with the next quoted name's opening quote mistaken for its close, than a
		// name that goes on to read ` FROM `.
		replaceEnd = wordEnd = openQuote.close + 1;
	} else if (!quoted) {
		while (wordEnd < text.length && IDENTIFIER_CHAR.test(text[wordEnd])) {
			wordEnd += 1;
		}
	}
	return {
		prefix,
		prefixStart,
		replaceStart: quoted ? prefixStart - 1 : prefixStart,
		replaceEnd,
		wordEnd,
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
