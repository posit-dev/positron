/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';

/**
 * The SQL parser, as a WebAssembly module loaded into the extension host.
 *
 * The analysis is Rust, built on apache/datafusion-sqlparser-rs and compiled to WebAssembly (see
 * `sql-analyzer/`). It runs here rather than in a language server process for two reasons. The
 * statement range provider has to answer the moment the user executes code, which rules out
 * anything that has to be started first or asked over a pipe. And a module has no runtime to find
 * on the user's machine, so SQL support is available wherever Positron runs, the web workbench
 * included.
 *
 * Every call is synchronous. The parser is fast enough on the documents a person edits that the
 * complexity of making it otherwise would buy nothing; the callers that should not run on every
 * keystroke are throttled where they are registered, not here.
 */

/** One statement of a document. Offsets are UTF-16, as an editor counts them. */
export interface StatementSpan {
	readonly start: number;

	/** Offset just past the statement's last character, including its terminating semicolon. */
	readonly end: number;

	/** Whether a semicolon closed it, as opposed to it running to the end of the document. */
	readonly terminated: boolean;
}

/** A syntax problem found in a document. */
export interface SyntaxDiagnostic {
	readonly start: number;
	readonly end: number;
	readonly message: string;
}

/** A real table the document names. */
export interface TableRef {
	readonly name: string;
	readonly schema?: string;
	readonly catalog?: string;

	/** What the statement called it, when it gave it an alias. */
	readonly alias?: string;

	/** Offsets of the table's own name: its qualifier is excluded, its quotes are not. */
	readonly start: number;
	readonly end: number;

	/** The scope the reference was found in. */
	readonly scope: number;

	/**
	 * Whether the name is one the statement defines for itself -- a CTE or a derived table --
	 * rather than a table in the database. Referring to one is correct SQL.
	 */
	readonly local: boolean;

	/** Whether this is the object a `CREATE` defines, which does not exist in the schema yet. */
	readonly definition: boolean;
}

/** A column the document names. */
export interface ColumnRef {
	readonly name: string;

	/** The table or alias the column was qualified with, if any. */
	readonly qualifier?: string;

	/** Offsets of the column's own name: its qualifier is excluded, its quotes are not. */
	readonly start: number;
	readonly end: number;

	readonly scope: number;
}

/** One naming scope: what a column written in it can be resolved against. */
export interface Scope {
	readonly parent?: number;

	/** Indices into {@link Analysis.tables} of the real tables this scope reads from. */
	readonly tables: readonly number[];

	/**
	 * Whether the scope reads from something whose columns cannot be known -- a derived table, a
	 * VALUES list, a table function. A column here may belong to the part that cannot be seen, so
	 * it must not be judged.
	 */
	readonly opaque: boolean;

	/**
	 * The names the statement defines at this level: CTEs, derived table aliases, and the names
	 * those are read under. A column qualified by one of these no more names a table in the
	 * database than the qualifier itself does.
	 */
	readonly locals: readonly string[];
}

/** Everything parsing a document turned up. */
export interface Analysis {
	readonly diagnostics: readonly SyntaxDiagnostic[];
	readonly scopes: readonly Scope[];
	readonly tables: readonly TableRef[];
	readonly columns: readonly ColumnRef[];

	/**
	 * Whether the configured dialect was not recognized, and the document was parsed without one.
	 * Reported so the user can be told, rather than left wondering why their dialect's syntax is
	 * being flagged.
	 */
	readonly unknownDialect: boolean;
}

/** A table the statement under the cursor can see. */
export interface SourceRef {
	readonly name: string;
	readonly schema?: string;
	readonly catalog?: string;
	readonly alias?: string;
}

/** What the statement under the cursor can see from there. */
export interface Sources {
	/** The real tables in scope, nearest first. */
	readonly sources: readonly SourceRef[];

	/**
	 * The names the statement defines for itself that the cursor can refer to: CTEs, derived table
	 * aliases, and the names those are read under. Always empty when {@link origin} is `tokens`,
	 * which cannot tell one from a real table.
	 */
	readonly locals: readonly string[];

	/**
	 * Whether the cursor can see something whose columns cannot be known -- a CTE, a derived table,
	 * a table function. A column completed here may be one of those, so it must not be judged.
	 */
	readonly opaque: boolean;

	/**
	 * How the answer was reached: `parsed` when the statement parsed with the cursor filled in, and
	 * the tables are the ones it can actually see; `tokens` when it did not, and they are every
	 * table the statement mentions. For the log, not for logic.
	 */
	readonly origin: string;
}

/** What a failed sources request answers: a statement that names nothing. */
const EMPTY_SOURCES: Sources = { sources: [], locals: [], opaque: false, origin: 'unavailable' };

/** The keywords that belong at one position, and which position that was. */
export interface KeywordsAt {
	readonly keywords: readonly string[];

	/**
	 * The name of the position the analyzer placed the cursor in, such as `tableItem` or
	 * `expectingBy`, or `everything` when it could not place it. For the log, not for logic.
	 */
	readonly position: string;
}

/** What every feature falls back to when there is nothing to analyze with. */
export const EMPTY_ANALYSIS: Analysis = {
	diagnostics: [],
	scopes: [],
	tables: [],
	columns: [],
	unknownDialect: false,
};

/**
 * What a failed keyword request answers.
 *
 * An empty list rather than the whole vocabulary: the module is only unavailable when it could not
 * be loaded at all, which the caller has already reported, and completing keywords into a document
 * nothing else is analyzing would be the one feature that looked like it was working.
 */
const EMPTY_KEYWORDS_AT: KeywordsAt = { keywords: [], position: 'unavailable' };

/** The shape of the module's exports; see the crate's `lib.rs` for the contract. */
interface AnalyzerExports {
	readonly memory: WebAssembly.Memory;
	readonly sql_alloc: (length: number) => number;
	readonly sql_analyze: (pointer: number, length: number) => number;
	readonly sql_free: (pointer: number) => void;
}

/** Bytes of length prefix on a response buffer. */
const HEADER = 4;

export class SqlAnalyzer {

	private readonly _encoder = new TextEncoder();
	private readonly _decoder = new TextDecoder();
	private _instance: WebAssembly.Instance;

	private constructor(
		private readonly _module: WebAssembly.Module,
		private readonly _onError: (message: string) => void,
	) {
		this._instance = new WebAssembly.Instance(this._module, {});
	}

	/**
	 * Compiles the module from a file. Synchronous, and takes a moment for a module this size, so
	 * callers do it once and keep the result.
	 *
	 * @param path The `.wasm` file, which ships in the extension's `resources` directory.
	 * @param onError Where to report a request the module could not answer.
	 */
	public static load(path: string, onError: (message: string) => void): SqlAnalyzer {
		return new SqlAnalyzer(new WebAssembly.Module(fs.readFileSync(path)), onError);
	}

	/** Splits a document into the statements it contains. */
	public statements(text: string, dialect: string): readonly StatementSpan[] {
		return this._request<{ statements: StatementSpan[] }>(
			{ op: 'statements', text, dialect },
		)?.statements ?? [];
	}

	/** Parses a document: its syntax errors, and every name it refers to. */
	public analyze(text: string, dialect: string): Analysis {
		return this._request<Analysis>({ op: 'analyze', text, dialect }) ?? EMPTY_ANALYSIS;
	}

	/**
	 * What the statement at an offset can see from there: the tables in scope, the names it
	 * defines for itself, and whether any of what it reads from is opaque.
	 *
	 * Answers for a statement that is halfway through being typed, which is the only state
	 * completion is ever asked about. An identifier is written into the hole the cursor is in
	 * before the statement is parsed, so that it parses at all and so that the answer can be
	 * scoped to where the cursor actually is: in
	 * `WITH recent AS (SELECT id FROM orders) SELECT | FROM recent` the cursor sees `recent` and
	 * not `orders`. When even that does not parse, the statement's tokens are read flat instead,
	 * which {@link Sources.origin} reports.
	 */
	public sources(text: string, dialect: string, offset: number): Sources {
		return this._request<Sources>({ op: 'sources', text, dialect, offset }) ?? EMPTY_SOURCES;
	}

	/**
	 * Every keyword the analyzer knows, whatever the position.
	 *
	 * Fixed for the life of the module, so callers cache it. Not what a completion request should
	 * offer -- that is {@link keywordsAt}, which is shorter by a factor of forty at most positions
	 * -- but the list to fall back on when a typed prefix matches nothing offered at the cursor.
	 */
	public keywords(): readonly string[] {
		return this._request<{ keywords: string[] }>({ op: 'keywords' })?.keywords ?? [];
	}

	/**
	 * The keywords worth completing at an offset, and the name of the position they came from.
	 *
	 * Varies with the offset and the dialect, so unlike {@link keywords} it cannot be cached. Pass
	 * the plain cursor offset: the analyzer drops the word being typed itself, so that
	 * `SELECT * FROM ord` answers for the table slot rather than for whatever `ord` might become.
	 *
	 * The position is returned for the caller's log. The list is a heuristic answer, and a
	 * surprising one is otherwise indistinguishable from a broken one.
	 */
	public keywordsAt(text: string, dialect: string, offset: number): KeywordsAt {
		return this._request<KeywordsAt>({ op: 'keywordsAt', text, dialect, offset })
			?? EMPTY_KEYWORDS_AT;
	}

	private _request<T>(request: object): T | undefined {
		try {
			return this._call<T>(request);
		} catch (error) {
			// A trap leaves the instance unusable -- the module aborts on panic rather than
			// unwinding -- so it is replaced before the next request rather than every request
			// after the first failing too.
			this._onError(`The SQL analyzer failed to answer a request: ${error}`);
			try {
				this._instance = new WebAssembly.Instance(this._module, {});
			} catch (restartError) {
				this._onError(`The SQL analyzer could not be restarted: ${restartError}`);
			}
			return undefined;
		}
	}

	private _call<T>(request: object): T {
		const exports = this._instance.exports as unknown as AnalyzerExports;
		const encoded = this._encoder.encode(JSON.stringify(request));

		const pointer = exports.sql_alloc(encoded.length);
		// A fresh view each time: any allocation may have grown the module's memory, which
		// detaches every ArrayBuffer taken from it before that point.
		new Uint8Array(exports.memory.buffer, pointer, encoded.length).set(encoded);

		// Takes ownership of the request buffer, so there is nothing left to free on this side.
		const response = exports.sql_analyze(pointer, encoded.length);
		try {
			const length = new DataView(exports.memory.buffer).getUint32(response, true);
			const json = this._decoder.decode(
				new Uint8Array(exports.memory.buffer, response + HEADER, length),
			);
			const parsed = JSON.parse(json);
			if (parsed.kind === 'error') {
				throw new Error(parsed.message);
			}
			// The tag the module discriminates its responses with has done its job by here, and is
			// not part of any of the shapes declared above.
			delete parsed.kind;
			return parsed as T;
		} finally {
			exports.sql_free(response);
		}
	}
}
