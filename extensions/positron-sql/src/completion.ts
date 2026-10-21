/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { LocalKind, Produced, SourceRef, SqlAnalyzer } from './analyzer';
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

/**
 * An identifier every dialect reads bare, keywords aside. The analyzer's own test, so the two
 * cannot disagree about which names it has to be asked about.
 */
const BARE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Dialects whose engine folds an unquoted name to lower case, so that `Customers` written bare
 * reads `customers` -- a different table, if the real one was created with quotes.
 */
const FOLDS_TO_LOWER = new Set(['postgres', 'redshift']);

/** Dialects whose engine folds an unquoted name to upper case, the other way round. */
const FOLDS_TO_UPPER = new Set(['snowflake', 'oracle']);

/** How many names' quoting to remember before starting over; bounds a long session's memory. */
const MAX_REMEMBERED_QUOTING = 50000;

/**
 * The quote character each dialect writes an identifier with, when it is not the standard one.
 *
 * Keyed by the names the `sql.dialect` setting offers and the connection drivers infer, since
 * those are the only names that reach here. sqlparser's own spellings are listed alongside them:
 * the parser accepts both (see `dialects.rs`), and a reader who knows it by one name should not
 * find the quoting keyed by the other.
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
 * The characters that open a quoted identifier, as completion triggers.
 *
 * The grammar scopes a quoted identifier as a string, where the editor does not suggest as the user
 * types, so without a trigger the list would never appear inside one unless asked for. `[` is left
 * out: outside T-SQL it opens an array subscript far more often than a name.
 */
export const QUOTE_TRIGGERS: readonly string[] = ['"', '`'];

/**
 * The analyzer positions where no name belongs, only a keyword or a literal: the row count after
 * `LIMIT`, `OFFSET`, `TOP` or `FETCH FIRST`.
 */
const NAMELESS_POSITIONS = new Set(['rowCount']);

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
	 * Which names need quoting, by dialect and name. The analyzer's answer is fixed for a pair, and
	 * asking costs a parse or three per keyword, so each is asked once -- a schema's worth at a
	 * time, the first time the schema is completed from.
	 */
	private readonly _quoting = new Map<string, Map<string, boolean>>();

	/** The schemas whose names have been asked about already, so a schema is primed once. */
	private readonly _primed = new WeakSet<SchemaIndex>();

	/**
	 * @param _context The world as it stands for one document. Per document, not per window: which
	 *   tables are known depends on the connection that file is written against.
	 */
	constructor(private readonly _context: (document: vscode.TextDocument) => CompletionContext) { }

	public provideCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_token?: vscode.CancellationToken,
		context?: vscode.CompletionContext,
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

		if (context?.triggerKind === vscode.CompletionTriggerKind.TriggerCharacter
			&& QUOTE_TRIGGERS.includes(context.triggerCharacter ?? '') && !cursor.quoted) {
			// The quote just typed closed an identifier rather than opening one. Nothing is being
			// typed, and a list popping up at the end of every quoted name would be in the way.
			return new vscode.CompletionList([], false);
		}

		// The extent a completion replaces. An explicit edit rather than letting the editor
		// decide: its own idea of the word under the cursor stops at a quote or a dot, which
		// would leave the opening quote of `"Order T` behind and insert a second one after it.
		const replace = new vscode.Range(
			document.positionAt(cursor.replaceStart),
			document.positionAt(cursor.replaceEnd),
		);
		const opening = cursor.quoted ? text[cursor.replaceStart] : undefined;

		const quote = this._quoter(analyzer, schema, dialect);
		const { tables: scope, names, relations, ctes } = inScope(analyzer, schema, dialect, text, cursor, offset);

		const qualifier = cursor.qualifiers.length > 0
			? cursor.qualifiers[cursor.qualifiers.length - 1]
			: undefined;

		let items: vscode.CompletionItem[];

		// Where the keywords came from, in the words the log ends up using. Left undefined after a
		// dot, where the qualifier already accounts for there being none.
		let keywordSource: string | undefined;

		if (qualifier !== undefined) {
			const qualified = qualifiedItems(qualifier, scope, [...relations, ...ctes], schema, quote, replace);
			items = qualified.items;
			if (items.length === 0) {
				log.trace(explainEmptyQualifier(qualifier, qualified.tables));
			}
		} else {
			const contextual = contextualKeywords(analyzer, cursor, text, dialect, offset);
			keywordSource = contextual.source;
			// A row count is a number: a column, table or alias there is a query that fails when
			// run, so the keywords that belong are all there is to offer.
			const namesBelong = !NAMELESS_POSITIONS.has(contextual.position ?? '');
			items = [
				...(namesBelong ? columnItems(scope, quote, replace) : []),
				...(namesBelong ? relations.flatMap(relation => producedItems(relation, schema, quote, replace)) : []),
				...(namesBelong ? nameItems(names, quote, replace) : []),
				...(namesBelong
					// Qualified when the engine would not find it unqualified: `sales.targets`,
					// where `targets` alone reads the default schema and fails.
					? schema.tables.map(table => tableItem(table, quote, replace, !schema.isDefault(table)))
					: []),
				...contextual.keywords.map(keyword => keywordItem(keyword, replace)),
			];
		}

		const prefix = cursor.prefix.toLowerCase();
		if (prefix) {
			const matching = items.filter(item => reaches(label(item), prefix));
			if (matching.length === 0 && qualifier === undefined && !cursor.quoted) {
				// Nothing offered matched, so the likeliest thing to have been wrong is the position
				// the keywords were chosen for, and the full vocabulary goes in rather than leaving
				// the user with an empty list. Conditioned on no item at all matching, so a prefix
				// that names a table does not drag a thousand keywords in behind it.
				// Held to the prefix itself, at the start of a word: the whole vocabulary is a
				// thousand entries, and letters scattered through them match far too many.
				items = keywords
					.filter(keyword => reaches(keyword, prefix, false))
					.map(keyword => keywordItem(keyword, replace));
				keywordSource = 'the full keyword list, nothing at the cursor having matched';
			} else {
				items = matching;
			}
		}

		if (opening !== undefined) {
			// The editor filters an item by the text from the start of its edit to the cursor, and
			// that edit starts at the opening quote. Filtered by its bare name, `order-events`
			// would never match the typed `` `ord ``, and nothing would survive to be shown.
			for (const item of items) {
				item.filterText = opening + label(item);
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

	/**
	 * How to write a name in this dialect: as it is, or quoted.
	 *
	 * Quoted when the analyzer says a keyword would not read back as the name, or when the engine
	 * folds unquoted names to a case the name is not in. Erring towards quoting is safe: the name
	 * is inserted exactly as the connection reported it, so a quoted one always names the right
	 * object.
	 */
	private _quoter(analyzer: SqlAnalyzer, schema: SchemaIndex, dialect: string): Quote {
		let known = this._quoting.get(dialect);
		if (!known) {
			known = new Map();
			this._quoting.set(dialect, known);
		}
		if (known.size > MAX_REMEMBERED_QUOTING) {
			known.clear();
			this._primed.delete(schema);
		}
		const answers = known;
		const ask = (names: readonly string[]) => {
			const asked = names.filter(name => BARE_IDENTIFIER.test(name) && !answers.has(name));
			if (asked.length === 0) {
				return;
			}
			const quoted = analyzer.quoting(asked, dialect);
			asked.forEach((name, at) => answers.set(name, quoted[at] ?? true));
		};
		if (!this._primed.has(schema)) {
			// Every name the schema could insert, in one request rather than one per item.
			this._primed.add(schema);
			ask(schemaNames(schema));
		}
		const open = DIALECT_QUOTES.get(dialect) ?? '"';
		return name => {
			if (BARE_IDENTIFIER.test(name)) {
				if (!answers.has(name)) {
					ask([name]);
				}
				const folds = (FOLDS_TO_LOWER.has(dialect) && name !== name.toLowerCase())
					|| (FOLDS_TO_UPPER.has(dialect) && name !== name.toUpperCase());
				if (!folds && answers.get(name) === false) {
					return name;
				}
			}
			if (open === '[') {
				// T-SQL brackets escape a closing bracket by doubling it, and have no opening escape.
				return `[${name.replace(/]/g, ']]')}]`;
			}
			return `${open}${name.split(open).join(open + open)}${open}`;
		};
	}
}

/** Writes a name the way a completion should insert it; see `_quoter`. */
type Quote = (name: string) => string;

/** Every name a schema could have a completion insert. */
function schemaNames(schema: SchemaIndex): string[] {
	const names = new Set<string>();
	for (const table of schema.tables) {
		names.add(table.name);
		for (const part of [table.schema, table.catalog]) {
			if (part) {
				names.add(part);
			}
		}
		for (const column of table.columns) {
			names.add(column.name);
		}
	}
	return [...names];
}

/**
 * Whether a typed prefix could be what the user means by a label: its first letter starts the
 * label or one of its words -- after an underscore, a space, or a change from lower to upper case
 * -- and the rest follow in order. So `id` reaches `user_id` and `CustomerID`, and `uid` reaches
 * `user_id`, the way the editor's own filter would, while `d` does not reach every name with a
 * `d` somewhere in it.
 *
 * @param scattered Whether the letters after the first may be spread through the rest of the
 *   label, rather than following the first in one piece.
 */
export function reaches(label: string, prefix: string, scattered = true): boolean {
	if (prefix.length === 0) {
		return true;
	}
	const folded = label.toLowerCase();
	for (let at = 0; at < label.length; at++) {
		const before = label[at - 1];
		const here = label[at];
		const boundary = at === 0 || before === '_' || before === ' '
			|| (before >= 'a' && before <= 'z' && here >= 'A' && here <= 'Z');
		const rest = scattered ? follows(folded, at + 1, prefix, 1) : folded.startsWith(prefix, at);
		if (boundary && folded[at] === prefix[0] && rest) {
			return true;
		}
	}
	return false;
}

/** Whether `prefix` from `from` appears in order, not necessarily together, in `text` from `start`. */
function follows(text: string, start: number, prefix: string, from: number): boolean {
	let at = start;
	for (let index = from; index < prefix.length; index++) {
		at = text.indexOf(prefix[index], at);
		if (at < 0) {
			return false;
		}
		at += 1;
	}
	return true;
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
): { keywords: readonly string[]; source: string; position?: string } {
	if (cursor.quoted) {
		// A quoted identifier is never a keyword, by the same reasoning that offers none after a
		// dot. The analyzer is not asked a question whose answer would only be thrown away.
		return { keywords: [], source: 'no keywords inside a quoted identifier' };
	}
	// The plain cursor offset, not `prefixStart`: the analyzer drops the partial word itself, so
	// that `SELECT * FROM ord` answers for the table slot rather than reading `ord` as a finished
	// token.
	const placed = analyzer.keywordsAt(text, dialect, offset);
	return {
		keywords: placed.keywords,
		source: `keywords for ${placed.position}`,
		position: placed.position,
	};
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
	relations: readonly Relation[],
	schema: SchemaIndex,
	quote: Quote,
	replace: vscode.Range,
): QualifiedCompletions {
	const folded = qualifier.toLowerCase();

	// A qualifier is an alias or a table name first: `o.` after `FROM orders o` means the columns
	// of orders, even if some schema is also called `o`.
	const qualified = scope.filter(entry => (entry.alias ?? entry.table.name).toLowerCase() === folded);
	if (qualified.length > 0) {
		return {
			items: columnItems(qualified, quote, replace),
			tables: qualified.map(entry => entry.table),
		};
	}
	// Then a CTE or derived table the statement reads under that name, whose columns are what its
	// own select list produced. Before the schema's tables: `WITH orders AS (...)` hides the real
	// one from the statement that declares it.
	const relation = relations.find(candidate => candidate.name.toLowerCase() === folded);
	if (relation) {
		return { items: producedItems(relation, schema, quote, replace), tables: [] };
	}
	const named = schema.resolve(qualifier).map(table => ({ alias: undefined, table }));
	if (named.length > 0) {
		return {
			items: columnItems(named, quote, replace),
			tables: named.map(entry => entry.table),
		};
	}
	if (schema.isNamespace(qualifier)) {
		const tables = schema.tablesInNamespace(qualifier);
		return { items: tables.map(table => tableItem(table, quote, replace, false)), tables };
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

/** What the cursor can see from where it is. */
interface InScope {
	/** The known tables, under the names the statement calls them. */
	readonly tables: ScopeEntry[];

	/**
	 * The names the statement made up that the cursor can write: its tables' aliases, and its
	 * locals. Independent of the schema, since the statement is what defines them.
	 */
	readonly names: readonly InScopeName[];

	/** The CTEs and derived tables the statement reads, under the names it reads them by. */
	readonly relations: readonly Relation[];

	/**
	 * The CTEs the statement declares, whether or not it reads them yet. Only a qualifier looks
	 * here: `recent.` is typed before the `FROM recent` that reads it, and means its columns then
	 * too, but a bare column of a CTE nothing reads is not one the statement can name.
	 */
	readonly ctes: readonly Relation[];
}

/** A relation the statement defines and reads, and the columns it produces. */
interface Relation {
	readonly name: string;
	readonly produces: Produced;
}

/** A name the statement defines, and what it stands for. */
interface InScopeName {
	readonly name: string;
	readonly kind: 'alias' | LocalKind;
	/** For a table's alias, the table; for a select-list alias, the column it renames. */
	readonly of?: string;
}

function inScope(
	analyzer: SqlAnalyzer,
	schema: SchemaIndex,
	dialect: string,
	text: string,
	cursor: ReturnType<typeof readCursor>,
	offset: number,
): InScope {
	// The identifier being typed is swapped for a plain one first, so that a half typed quoted
	// identifier does not cost the statement its tables; see `probeText`.
	const probe = cursor.quoted ? probeText(text, cursor) : { text, offset };
	// Scoped to where the cursor is rather than to everything the statement mentions: the select
	// after a `WITH` reads from the CTE, not from the tables the CTE reads from, and offering
	// those columns there would be offering names that are errors.
	const { sources, locals } = analyzer.sources(probe.text, dialect, probe.offset);

	const tables: ScopeEntry[] = [];
	const names: InScopeName[] = [];
	const relations: Relation[] = [];
	const ctes: Relation[] = [];
	for (const source of sources) {
		for (const table of resolveSource(schema, source)) {
			tables.push({ alias: source.alias, table });
		}
		if (source.alias) {
			const of = [source.catalog, source.schema, source.name].filter(part => part).join('.');
			names.push({ name: source.alias, kind: 'alias', of });
		}
	}
	for (const local of locals) {
		if (local.kind === 'relation' && local.produces) {
			relations.push({ name: local.name, produces: local.produces });
		} else if (local.kind === 'cte' && local.produces) {
			ctes.push({ name: local.name, produces: local.produces });
		}
		const of = local.column
			? [local.column.qualifier, local.column.name].filter(part => part).join('.')
			: undefined;
		names.push({ name: local.name, kind: local.kind, of });
	}
	return { tables, names, relations, ctes };
}

/**
 * The columns a CTE or derived table produces, as completions: the names its select list gives,
 * and the schema's columns for each real table it passes through with a `*`.
 */
function producedItems(
	relation: Relation,
	schema: SchemaIndex,
	quote: Quote,
	replace: vscode.Range,
): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	const seen = new Set<string>();
	const add = (item: vscode.CompletionItem) => {
		const folded = label(item).toLowerCase();
		if (!seen.has(folded)) {
			seen.add(folded);
			items.push(item);
		}
	};
	for (const name of relation.produces.columns) {
		const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
		item.detail = vscode.l10n.t('column');
		item.documentation = vscode.l10n.t('Column of {0}', relation.name);
		item.sortText = SORT_COLUMN + name.toLowerCase();
		item.textEdit = new vscode.TextEdit(replace, quote(name));
		add(item);
	}
	for (const star of relation.produces.stars ?? []) {
		for (const table of resolveSource(schema, star)) {
			for (const column of table.columns) {
				add(columnItem(column, table, quote, replace));
			}
		}
	}
	return items;
}

/**
 * The names the statement defines, as completions.
 *
 * An alias is how the statement refers to its table from then on, and the way to its columns is
 * typing it and a dot; a select-list alias is what an `ORDER BY` names. Both rank with the
 * columns. A CTE is read the way a table is, and ranks with the tables. One item per name: a CTE
 * once read is both a CTE and the relation it is read as, and is the same word to type either way.
 */
function nameItems(
	names: readonly InScopeName[],
	quote: Quote,
	replace: vscode.Range,
): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	const seen = new Set<string>();
	for (const { name, kind, of } of names) {
		const folded = name.toLowerCase();
		if (seen.has(folded)) {
			continue;
		}
		seen.add(folded);

		const cte = kind === 'cte';
		const item = new vscode.CompletionItem(
			name,
			cte ? vscode.CompletionItemKind.Class : vscode.CompletionItemKind.Variable,
		);
		switch (kind) {
			case 'alias':
				item.detail = vscode.l10n.t('alias');
				item.documentation = vscode.l10n.t('Alias of {0}', of ?? name);
				break;
			case 'relation':
				item.detail = vscode.l10n.t('alias');
				item.documentation = vscode.l10n.t('A subquery, table function or CTE this statement reads');
				break;
			case 'output':
				item.detail = vscode.l10n.t('column alias');
				item.documentation = of
					? vscode.l10n.t('Alias of {0}', of)
					: vscode.l10n.t('Alias of a select-list expression');
				break;
			case 'cte':
				item.detail = vscode.l10n.t('CTE');
				item.documentation = vscode.l10n.t('Common table expression this statement declares');
				break;
		}
		item.sortText = (cte ? SORT_TABLE : SORT_COLUMN) + folded;
		item.textEdit = new vscode.TextEdit(replace, quote(name));
		items.push(item);
	}
	return items;
}

function resolveSource(schema: SchemaIndex, source: SourceRef): readonly SqlTable[] {
	return schema.resolve(source.name, source.schema, source.catalog);
}

function columnItems(
	scope: readonly ScopeEntry[],
	quote: Quote,
	replace: vscode.Range,
): vscode.CompletionItem[] {
	const items: vscode.CompletionItem[] = [];
	for (const { table } of scope) {
		for (const column of table.columns) {
			items.push(columnItem(column, table, quote, replace));
		}
	}
	return items;
}

function columnItem(
	column: SqlColumn,
	table: SqlTable,
	quote: Quote,
	replace: vscode.Range,
): vscode.CompletionItem {
	const item = new vscode.CompletionItem(column.name, vscode.CompletionItemKind.Field);
	item.detail = column.isPrimaryKey
		? vscode.l10n.t('{0} (primary key)', column.dataType ?? 'column')
		: column.dataType ?? 'column';
	item.documentation = vscode.l10n.t('Column of {0}', qualifiedName(table));
	item.sortText = SORT_COLUMN + column.name.toLowerCase();
	item.textEdit = new vscode.TextEdit(replace, quote(column.name));
	return item;
}

/**
 * @param qualify Whether to insert the table's schema in front of it, for a table an unqualified
 *   name would not find.
 */
function tableItem(table: SqlTable, quote: Quote, replace: vscode.Range, qualify: boolean): vscode.CompletionItem {
	const item = new vscode.CompletionItem(table.name, vscode.CompletionItemKind.Class);
	item.detail = table.kind;
	item.documentation = table.connection
		? `${qualifiedName(table)} (${table.connection})`
		: qualifiedName(table);
	item.sortText = SORT_TABLE + table.name.toLowerCase();
	const name = qualify && table.schema ? `${quote(table.schema)}.${quote(table.name)}` : quote(table.name);
	item.textEdit = new vscode.TextEdit(replace, name);
	return item;
}

function keywordItem(keyword: string, replace: vscode.Range): vscode.CompletionItem {
	const item = new vscode.CompletionItem(keyword, vscode.CompletionItemKind.Keyword);
	item.detail = 'keyword';
	item.sortText = SORT_KEYWORD + keyword;
	item.textEdit = new vscode.TextEdit(replace, keyword);
	return item;
}

/** A position as the editor shows it, so a log line points at a place the user can see. */
function at(position: vscode.Position): string {
	return `line ${position.line + 1}, column ${position.character + 1}`;
}

function label(item: vscode.CompletionItem): string {
	return typeof item.label === 'string' ? item.label : item.label.label;
}
