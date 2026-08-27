/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { SourceRef, SqlAnalyzer } from './analyzer';
import { probeText, readCursor } from './cursor';
import { SqlLog } from './log';
import { SqlColumn, SqlTable } from './schema';
import { qualifiedName, SchemaIndex } from './schemaIndex';

/**
 * Completions for a SQL document: keywords, tables and columns.
 *
 * Completion has to work on text that does not parse, because the user is in the middle of typing
 * it. So the cursor's surroundings are read off the raw text (see `cursor.ts`), and the statement
 * around it is consulted for the two questions that text alone cannot answer -- which tables are in
 * scope, and which keywords belong where the cursor is. The analyzer reads both off the statement's
 * tokens rather than a tree, and so can answer whatever state the statement is in.
 */

/**
 * Ceiling on one completion response.
 *
 * A warehouse with tens of thousands of columns would otherwise produce a list the editor spends
 * longer filtering than the user spends typing the next character. Past the cap the list is
 * marked incomplete, so the editor asks again with a longer prefix rather than showing a
 * truncated list as though it were the whole answer.
 *
 * Only a schema can reach it. A position offers keywords in the tens, and even the full vocabulary
 * the prefix-miss fallback restores is a fraction of the cap, so a wide schema is the one thing
 * that is ever truncated -- which is the case the cap exists for.
 */
const MAX_ITEMS = 5000;

/**
 * Sort groups, most specific first.
 *
 * The editor sorts by `sortText` before its own fuzzy score, so these are what make a column of a
 * table the statement already selects from outrank a keyword that happens to match better.
 */
const SORT_COLUMN = '1';
const SORT_TABLE = '2';
const SORT_KEYWORD = '3';

/** An identifier that needs no quoting when inserted. */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * The quote character each dialect writes an identifier with, when it is not the standard one.
 *
 * Keyed by the names the `sql.dialect` setting offers and the connection drivers infer, since
 * those are the only names that reach here. sqlparser's own spellings are listed alongside them:
 * the parser accepts both (see `dialects.rs`), and a reader who knows it by one name should not
 * find the quoting keyed by the other.
 */
const DIALECT_QUOTES = new Map([
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

/** What a completion request needs to know about the world, gathered by the caller. */
export interface CompletionContext {
	/** Undefined when the analyzer could not be loaded, in which case nothing is offered. */
	readonly analyzer: SqlAnalyzer | undefined;
	readonly schema: SchemaIndex;
	readonly dialect: string;

	/**
	 * Every keyword the analyzer knows, cached by the caller, held for the prefix-miss fallback
	 * rather than offered as it stands.
	 *
	 * What belongs at a position is a heuristic, and some keywords -- a `CASE` arm, `ESCAPE` after
	 * `LIKE` -- it deliberately places nowhere; see the crate's `keywords.rs`. Restoring the whole
	 * vocabulary when a typed prefix matches nothing at all means a blind spot costs a user another
	 * keystroke rather than a completion they could reach before.
	 */
	readonly keywords: readonly string[];

	/**
	 * Where each request reports what it offered and why.
	 *
	 * An empty list is the one outcome a user cannot read anything off, and it has several quite
	 * different causes, so every request leaves a line at trace saying which one it was.
	 */
	readonly log: SqlLog;
}

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {

	/**
	 * @param _context The world as it stands for one document. Per document, not per window: which
	 *   tables are known depends on the connection that file is written against.
	 */
	constructor(private readonly _context: (document: vscode.TextDocument) => CompletionContext) { }

	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
	): vscode.CompletionList {
		const { analyzer, schema, dialect, keywords, log } = this._context(document);
		if (!analyzer) {
			// Silent here: the load failure was reported once, with the reason, and this path is
			// reached on every keystroke thereafter.
			return new vscode.CompletionList([], false);
		}

		const text = document.getText();
		const offset = document.offsetAt(position);

		const cursor = readCursor(text, offset);
		if (cursor.suppressed) {
			// Inside a string literal or a line comment, where no identifier belongs.
			log.trace(`Nothing is completed at ${at(position)}: the cursor is inside a string literal`
				+ ' or a comment.');
			return new vscode.CompletionList([], false);
		}

		// The extent a completion replaces. An explicit edit rather than letting the editor
		// decide: its own idea of the word under the cursor stops at a quote or a dot, which
		// would leave the opening quote of `"Order T` behind and insert a second one after it.
		const replace = new vscode.Range(document.positionAt(cursor.replaceStart), position);

		const scope = schema.isEmpty ? [] : tablesInScope(analyzer, schema, dialect, text, cursor, offset);

		const qualifier = cursor.qualifiers.length > 0
			? cursor.qualifiers[cursor.qualifiers.length - 1]
			: undefined;

		let items: vscode.CompletionItem[];

		// Where the keywords came from, in the words the log ends up using. Left undefined after a
		// dot, where the qualifier already accounts for there being none.
		let keywordSource: string | undefined;

		if (qualifier !== undefined) {
			const qualified = qualifiedItems(qualifier, scope, schema, dialect, replace);
			items = qualified.items;
			if (items.length === 0) {
				log.trace(explainEmptyQualifier(qualifier, qualified.tables));
			}
		} else {
			const contextual = contextualKeywords(analyzer, cursor, text, dialect, offset);
			keywordSource = contextual.source;
			items = [
				...columnItems(scope, dialect, replace),
				...schema.tables.map(table => tableItem(table, dialect, replace)),
				...contextual.keywords.map(keyword => keywordItem(keyword, replace)),
			];
		}

		const prefix = cursor.prefix.toLowerCase();
		if (prefix) {
			const matching = items.filter(item => label(item).toLowerCase().startsWith(prefix));
			if (matching.length === 0 && qualifier === undefined && !cursor.quoted) {
				// Nothing offered matched, so the likeliest thing to have been wrong is the position
				// the keywords were chosen for, and the full vocabulary goes in rather than leaving
				// the user with an empty list. Conditioned on no item at all matching, so a prefix
				// that names a table does not drag a thousand keywords in behind it.
				items = keywords
					.filter(keyword => keyword.toLowerCase().startsWith(prefix))
					.map(keyword => keywordItem(keyword, replace));
				keywordSource = 'the full keyword list, nothing at the cursor having matched';
			} else {
				items = matching;
			}
		}

		const isIncomplete = items.length > MAX_ITEMS;
		if (isIncomplete) {
			items.sort((left, right) => (left.sortText ?? '').localeCompare(right.sortText ?? ''));
			items = items.slice(0, MAX_ITEMS);
		}

		// One line per request, naming everything that decided the list: the qualifier the items had
		// to belong to, the prefix they were filtered by, how many tables the statement put in
		// scope, and the position the keywords were chosen for. Between them they account for an
		// empty list, or a surprising one, without having to guess.
		log.trace(`Completed ${items.length} item(s) at ${at(position)}`
			+ `${qualifier === undefined ? '' : ` after "${qualifier}."`}`
			+ `${cursor.prefix ? ` for prefix "${cursor.prefix}"` : ''}:`
			+ ` ${scope.length} table(s) in scope, ${schema.tables.length} known`
			+ `${keywordSource === undefined ? '' : `, ${keywordSource}`}`
			+ `${isIncomplete ? `, capped at ${MAX_ITEMS}` : ''}.`);

		return new vscode.CompletionList(items, isIncomplete);
	}
}

/**
 * The keywords that belong where an unqualified cursor is, and a phrase naming where they came
 * from for the log.
 *
 * One analyzer call per request, which cannot be cached the way the full vocabulary is: the answer
 * is what the offset and the dialect make it. A document with no connection open therefore does
 * make a call per keystroke now, where the schema-guarded table lookup used to leave it making
 * none -- keywords need no schema. It tokenizes the document and nothing more.
 */
function contextualKeywords(
	analyzer: SqlAnalyzer,
	cursor: ReturnType<typeof readCursor>,
	text: string,
	dialect: string,
	offset: number,
): { keywords: readonly string[]; source: string } {
	if (cursor.quoted) {
		// A quoted identifier is never a keyword, by the same reasoning that offers none after a
		// dot. The analyzer is not asked a question whose answer would only be thrown away.
		return { keywords: [], source: 'no keywords inside a quoted identifier' };
	}
	// The plain cursor offset, not `prefixStart`: the analyzer drops the partial word itself, so
	// that `SELECT * FROM ord` answers for the table slot rather than reading `ord` as a finished
	// token.
	const placed = analyzer.keywordsAt(text, dialect, offset);
	return { keywords: placed.keywords, source: `keywords for ${placed.position}` };
}

/**
 * What a qualifier named, alongside what is offered for it.
 *
 * The tables come back with the items because an empty list has two causes that call for
 * different things from the user, and only the resolution tells them apart.
 */
interface QualifiedCompletions {
	readonly items: vscode.CompletionItem[];

	/** The tables the qualifier resolved to, empty if it named nothing known. */
	readonly tables: readonly SqlTable[];
}

/** What to offer after a dot, which is never a keyword. */
function qualifiedItems(
	qualifier: string,
	scope: readonly ScopeEntry[],
	schema: SchemaIndex,
	dialect: string,
	replace: vscode.Range,
): QualifiedCompletions {
	const folded = qualifier.toLowerCase();

	// A qualifier is an alias or a table name first: `o.` after `FROM orders o` means the columns
	// of orders, even if some schema is also called `o`.
	let qualified = scope.filter(entry => (entry.alias ?? entry.table.name).toLowerCase() === folded);
	if (qualified.length === 0) {
		qualified = schema.tablesNamed(qualifier).map(table => ({ alias: undefined, table }));
	}
	if (qualified.length > 0) {
		return {
			items: columnItems(qualified, dialect, replace),
			tables: qualified.map(entry => entry.table),
		};
	}
	if (schema.isNamespace(qualifier)) {
		const tables = schema.tablesInNamespace(qualifier);
		return { items: tables.map(table => tableItem(table, dialect, replace)), tables };
	}
	// The qualifier names nothing known. No keywords here: one is never valid immediately after a
	// dot, and offering the whole list would bury the point that the qualifier was not recognized.
	return { items: [], tables: [] };
}

/**
 * Why a dot produced no completions.
 *
 * The two cases are the same empty list in the editor but nothing alike behind it: a qualifier
 * that names nothing is a typo, or a table in a database that is not open, and the user has to
 * fix or connect something. A qualifier that resolves to tables carrying no columns means the
 * schema read stopped above their fields, and the tables are there to be read again.
 *
 * Pure, and exported, because which of the two a user is looking at is the whole content of the
 * message and is worth testing without a log to read it out of.
 *
 * @param qualifier The name written before the dot.
 * @param tables The tables it resolved to, empty if it resolved to nothing.
 */
export function explainEmptyQualifier(qualifier: string, tables: readonly SqlTable[]): string {
	if (tables.length === 0) {
		return `Nothing is completed after "${qualifier}.": "${qualifier}" is not an alias in this`
			+ ' statement, nor a table or namespace of the data connection this file is written'
			+ ' against.';
	}
	return `Nothing is completed after "${qualifier}.": it names`
		+ ` ${tables.map(qualifiedName).join(', ')}, which reported no columns. The connection's`
		+ ' schema was probably larger than the read limit; see the line logged when it was read.';
}

/** A table the statement reads from, under the name the statement calls it. */
interface ScopeEntry {
	readonly alias: string | undefined;
	readonly table: SqlTable;
}

/** The known tables the statement under the cursor reads from. */
function tablesInScope(
	analyzer: SqlAnalyzer,
	schema: SchemaIndex,
	dialect: string,
	text: string,
	cursor: ReturnType<typeof readCursor>,
	offset: number,
): ScopeEntry[] {
	// The identifier being typed is swapped for a plain one first, so that a half typed quoted
	// identifier does not cost the statement its tables; see `probeText`.
	const probe = cursor.quoted ? probeText(text, cursor, offset) : { text, offset };
	const entries: ScopeEntry[] = [];
	for (const source of analyzer.sources(probe.text, dialect, probe.offset)) {
		for (const table of resolveSource(schema, source)) {
			entries.push({ alias: source.alias, table });
		}
	}
	return entries;
}

function resolveSource(schema: SchemaIndex, source: SourceRef): readonly SqlTable[] {
	return schema.resolve(source.name, source.schema, source.catalog);
}

function columnItems(
	scope: readonly ScopeEntry[],
	dialect: string,
	replace: vscode.Range,
): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	for (const { table } of scope) {
		for (const column of table.columns) {
			items.push(columnItem(column, table, dialect, replace));
		}
	}
	return items;
}

function columnItem(
	column: SqlColumn,
	table: SqlTable,
	dialect: string,
	replace: vscode.Range,
): vscode.CompletionItem {
	const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
	item.detail = column.isPrimaryKey
		? vscode.l10n.t('{0} (primary key)', column.dataType ?? 'column')
		: column.dataType ?? 'column';
	item.documentation = vscode.l10n.t('Column of {0}', qualifiedName(table));
	item.sortText = SORT_COLUMN + column.name.toLowerCase();
	item.textEdit = new vscode.TextEdit(replace, insertText(column.name, dialect));
	return item;
}

function tableItem(table: SqlTable, dialect: string, replace: vscode.Range): vscode.CompletionItem {
	const item = new vscode.CompletionItem(table.name, vscode.CompletionItemKind.Class);
	item.detail = table.kind;
	item.documentation = table.connection
		? `${qualifiedName(table)} (${table.connection})`
		: qualifiedName(table);
	item.sortText = SORT_TABLE + table.name.toLowerCase();
	item.textEdit = new vscode.TextEdit(replace, insertText(table.name, dialect));
	return item;
}

function keywordItem(keyword: string, replace: vscode.Range): vscode.CompletionItem {
	const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
	item.detail = 'keyword';
	item.sortText = SORT_KEYWORD + keyword;
	item.textEdit = new vscode.TextEdit(replace, keyword);
	return item;
}

/** The text to insert for an identifier, quoted the way the dialect writes one if it has to be. */
function insertText(name: string, dialect: string): string {
	if (BARE_IDENTIFIER.test(name)) {
		return name;
	}
	const open = DIALECT_QUOTES.get(dialect) ?? '"';
	if (open === '[') {
		// T-SQL brackets escape a closing bracket by doubling it, and have no opening escape.
		return `[${name.replace(/]/g, ']]')}]`;
	}
	return `${open}${name.split(open).join(open + open)}${open}`;
}

/** A position as the editor shows it, so a log line points at a place the user can see. */
function at(position: vscode.Position): string {
	return `line ${position.line + 1}, column ${position.character + 1}`;
}

function label(item: vscode.CompletionItem): string {
	return typeof item.label === 'string' ? item.label : item.label.label;
}
