/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Analysis, Renamed, Scope, TableRef } from './analyzer';
import { SqlTable } from './schema';
import { displayName, SchemaIndex } from './schemaIndex';

/**
 * Matching the names a document contains against the tables the user is connected to.
 *
 * Shared by the two features that need to know what a name in the document points at: diagnostics
 * for names the connected database does not have, and document links that reveal a name in the
 * Data Connections pane. Both want the same thing -- every name, where it sits, and what it
 * resolved to -- so it is worked out once here.
 *
 * The analyzer has already said what the *statement* means: which tables each scope reads from,
 * which names it defines for itself, and which scopes cannot be judged at all. What is left is
 * the half that needs the schema, and it is deliberately one-sided. Where it cannot be sure, it
 * says nothing: its output ends up as a warning on SQL the user wrote and probably knows to be
 * correct, so a name it stays quiet about costs a little coverage, while a name it wrongly flags
 * costs the feature its credibility.
 */

/**
 * Prefixes the engines reserve for their own catalog tables, which a connection does not list as
 * the user's: `pg_class`, `sqlite_master`. A name with one is the engine's, not a typo.
 */
const SYSTEM_TABLE_PREFIXES = ['pg_', 'sqlite_'];

/**
 * Columns every row of a table has without the table declaring them, which a connection therefore
 * does not report: SQLite's and DuckDB's `rowid`, PostgreSQL's `ctid` and its transaction
 * columns, Oracle's `rownum`. Fixed by each engine rather than by the user's schema.
 */
const SYSTEM_COLUMNS = new Set([
	'rowid', '_rowid_', 'oid', 'ctid', 'xmin', 'xmax', 'cmin', 'cmax', 'tableoid', 'rownum',
]);

export interface Reference {
	readonly kind: 'table' | 'column';
	readonly name: string;

	/** Offsets of the name itself. Its qualifier is excluded, its quotes are not. */
	readonly start: number;
	readonly end: number;

	readonly status: 'resolved' | 'unknown';

	/** The schema table this resolved to: the table itself, or a column's owning table. */
	readonly table?: SqlTable;

	/**
	 * For a column written as the alias a select item gave it, the column the alias renames: the
	 * name to find in {@link table}, where {@link name} is what the document says.
	 */
	readonly aliasOf?: string;

	/**
	 * For an unknown column, the qualified names of the tables it was looked for in, so a
	 * diagnostic can say where it was not found rather than only that it was not.
	 */
	readonly searched: readonly string[];
}

/** What a scope can resolve a column against, once the schema has had its say. */
interface ResolvedScope {
	/** The tables in scope, by the name the statement reads each one under. */
	readonly byName: Map<string, SqlTable>;

	/** Every table in scope, in the order the statement named them. */
	readonly tables: SqlTable[];

	/**
	 * Whether anything in the scope cannot be resolved: a CTE, a derived table, or a real table
	 * the schema does not have. An unqualified column in such a scope may belong to the part that
	 * cannot be seen, so it is not judged.
	 */
	opaque: boolean;

	/** The names that resolve to nothing lookupable, so a column qualified by one is left alone. */
	readonly unresolvable: Set<string>;

	/**
	 * The names, as the statement reads them, of tables whose columns the document itself changes
	 * or defines -- an ALTER TABLE, a CREATE that replaces one. A column of one of these resolves
	 * when the schema has it, and is never flagged when it does not.
	 */
	readonly changed: Set<string>;

	/** The select-list aliases in scope that rename a column, and the column each renames. */
	readonly aliases: Map<string, Renamed>;
}

/**
 * What the document does to tables, by folded name, and where it first does it. A statement only
 * sees what the statements before it did: a table read above the CREATE that makes it is still
 * missing when that read runs.
 */
interface DocumentFacts {
	/** Tables a CREATE, or a rename, brings into being. */
	readonly defined: Map<string, number>;

	/** Tables whose columns are changed: altered, or defined over an existing one. */
	readonly changed: Map<string, number>;
}

/** Whether a fact recorded at some offset already holds at `offset`. */
function holdsAt(facts: Map<string, number>, name: string, offset: number): boolean {
	const from = facts.get(fold(name));
	return from !== undefined && from <= offset;
}

/** Finds every table and column name in a parsed document and resolves it against the schema. */
export function resolveReferences(analysis: Analysis, schema: SchemaIndex): Reference[] {
	const references: Reference[] = [];
	const facts = documentFacts(analysis);
	const scopes = analysis.scopes.map((_, index) => resolveScope(index, analysis, schema, facts));

	for (const table of analysis.tables) {
		// A CTE, or the object a CREATE is defining. Both are correct SQL that names nothing in
		// the database, so neither is a name to check.
		if (table.local || table.definition) {
			continue;
		}
		const { matches, judgeable } = lookUp(schema, table);
		if (matches.length === 0 && (!judgeable || holdsAt(facts.defined, table.name, table.start))) {
			// Either something the schema cannot speak for -- a namespace it does not list, the
			// engine's own catalog -- or a table an earlier statement in this file creates. A
			// script that creates a table and then reads it is correct before it has run.
			continue;
		}
		references.push({
			kind: 'table',
			name: table.name,
			start: table.start,
			end: table.end,
			status: matches.length > 0 ? 'resolved' : 'unknown',
			table: matches[0],
			searched: [],
		});
	}

	for (const column of analysis.columns) {
		const reference = resolveColumn(column, analysis, scopes);
		if (reference) {
			references.push(reference);
		}
	}

	references.sort((left, right) => left.start - right.start);
	return references;
}

function resolveColumn(
	column: Analysis['columns'][number],
	analysis: Analysis,
	scopes: readonly ResolvedScope[],
): Reference | undefined {
	const scope = scopes[column.scope];
	if (!scope) {
		return undefined;
	}
	// The scopes a column can reach, its own first. A subquery may name the columns of the query
	// it sits in -- `WHERE EXISTS (SELECT 1 FROM b WHERE b.x = total)` -- and those are found
	// further out.
	const reachable = [scope, ...enclosing(column.scope, analysis, scopes)];

	let candidates: SqlTable[];
	let lenient: boolean;
	if (column.qualifier !== undefined) {
		const qualifier = fold(column.qualifier);
		// The nearest scope that knows the qualifier decides. One that cannot see into it -- a
		// derived table, a table the schema does not have -- means the column below it is not a
		// second mistake, and a second squiggle would be one mistake reported twice.
		const owner = reachable.find(each => each.unresolvable.has(qualifier) || each.byName.has(qualifier));
		const table = owner?.byName.get(qualifier);
		if (!owner || !table) {
			return undefined;
		}
		candidates = [table];
		lenient = owner.changed.has(qualifier);
	} else if (scope.aliases.has(fold(column.name))) {
		// `uis` in `WHERE uis = 10` after `SELECT UnitsInStock AS uis`: the column it renames,
		// found where that column would be. Only ever resolved, never flagged -- the alias is
		// correct SQL whether or not the column behind it can be found.
		return resolveAlias(column, scope);
	} else if (scope.unresolvable.has(fold(column.name))) {
		// A name the statement made up rather than read from a table: the alias of a select
		// item that an `ORDER BY` refers back to, or a CTE. Looking one up in the schema finds
		// nothing, and saying so would flag `SELECT total AS t FROM orders ORDER BY t`, which
		// is ordinary SQL.
		return undefined;
	} else if (scope.opaque || scope.tables.length === 0) {
		return undefined;
	} else {
		candidates = scope.tables;
		lenient = scope.changed.size > 0;
	}

	let owner = findOwner(candidates, column.name);
	let searched = candidates;
	if (!owner && column.qualifier === undefined) {
		// Not in the column's own tables, so possibly a correlated reference to an enclosing
		// query's. Judged only if every scope on the way out can be seen into.
		const outer = reachable.slice(1);
		const further = outer.flatMap(each => each.tables);
		owner = findOwner(further, column.name);
		searched = [...candidates, ...further.filter(table => !candidates.includes(table))];
		lenient ||= outer.some(each => each.opaque || each.changed.size > 0);
	}

	if (!owner && (lenient || SYSTEM_COLUMNS.has(fold(column.name)))) {
		return undefined;
	}
	return {
		kind: 'column',
		name: column.name,
		start: column.start,
		end: column.end,
		status: owner ? 'resolved' : 'unknown',
		table: owner,
		searched: owner ? [] : searched.map(displayName),
	};
}

/** The resolved scopes enclosing a scope, nearest first. */
function enclosing(index: number, analysis: Analysis, scopes: readonly ResolvedScope[]): ResolvedScope[] {
	const found: ResolvedScope[] = [];
	// Bounded by the number of scopes: a parent always has a lower index, but this runs on the
	// user's keystrokes and a loop is the one failure that cannot be recovered from.
	let at = analysis.scopes[index]?.parent;
	for (let step = 0; at !== undefined && step < analysis.scopes.length; step++) {
		const resolved = scopes[at];
		if (resolved) {
			found.push(resolved);
		}
		at = analysis.scopes[at]?.parent;
	}
	return found;
}

function findOwner(tables: readonly SqlTable[], name: string): SqlTable | undefined {
	const folded = fold(name);
	return tables.find(table => table.columns.some(column => fold(column.name) === folded));
}

/**
 * Looks a table reference up, and says whether a miss would mean anything.
 *
 * A qualifier the schema does not list cannot be judged: it is a database attached to the session
 * (`other.orders` in DuckDB), the engine's own catalog (`information_schema.tables`), or a level
 * the connection does not report (`main.orders` in SQLite, `mydb.public.orders` in PostgreSQL).
 * The parts that are known still narrow the search, and a schema that reports no namespaces at all
 * is searched by name, so the last two cases still resolve.
 */
function lookUp(schema: SchemaIndex, table: TableRef): { matches: readonly SqlTable[]; judgeable: boolean } {
	const known = (part: string | undefined) => part !== undefined && schema.isNamespace(part);
	const schemaPart = known(table.schema) ? table.schema : undefined;
	const catalogPart = known(table.catalog) ? table.catalog : undefined;
	const qualified = table.schema !== undefined || table.catalog !== undefined;
	const allKnown = schemaPart === table.schema && catalogPart === table.catalog;
	const system = !qualified && SYSTEM_TABLE_PREFIXES.some(prefix => fold(table.name).startsWith(prefix));

	if (allKnown) {
		return { matches: schema.resolve(table.name, schemaPart, catalogPart), judgeable: !system };
	}
	if (schemaPart !== undefined || catalogPart !== undefined || !schema.hasNamespaces) {
		return { matches: schema.resolve(table.name, schemaPart, catalogPart), judgeable: false };
	}
	return { matches: [], judgeable: false };
}

function documentFacts(analysis: Analysis): DocumentFacts {
	const defined = new Map<string, number>();
	const changed = new Map<string, number>();
	const record = (facts: Map<string, number>, name: string, at: number) => {
		const folded = fold(name);
		facts.set(folded, Math.min(facts.get(folded) ?? at, at));
	};
	for (const table of analysis.tables) {
		if (table.definition) {
			record(defined, table.name, table.start);
			record(changed, table.name, table.start);
		}
		if (table.altered) {
			record(changed, table.name, table.start);
		}
	}
	return { defined, changed };
}

function resolveScope(index: number, analysis: Analysis, schema: SchemaIndex, facts: DocumentFacts): ResolvedScope {
	const scope = analysis.scopes[index];
	const resolved: ResolvedScope = {
		byName: new Map(),
		tables: [],
		opaque: scope.opaque,
		unresolvable: new Set(),
		changed: new Set(),
		aliases: new Map(),
	};

	// Names the statement defines for itself, at this level and every level enclosing it. A CTE
	// declared at the top of a statement is in scope for a subquery six levels down.
	for (let at: number | undefined = index; at !== undefined;) {
		const enclosingScope: Scope | undefined = analysis.scopes[at];
		if (!enclosingScope) {
			break;
		}
		for (const local of enclosingScope.locals) {
			resolved.unresolvable.add(fold(local.name));
			// Nearest first, so an inner select's alias is not shadowed by an outer one's.
			if (local.kind === 'output' && local.column && !resolved.aliases.has(fold(local.name))) {
				resolved.aliases.set(fold(local.name), local.column);
			}
		}
		at = enclosingScope.parent;
	}

	for (const index of scope.tables) {
		const table = analysis.tables[index];
		if (!table) {
			continue;
		}
		const name = fold(table.alias ?? table.name);
		const { matches } = lookUp(schema, table);
		if (matches.length === 0) {
			// Reported as an unknown table in its own right, or not judged at all; either way its
			// columns could be anything.
			resolved.opaque = true;
			resolved.unresolvable.add(name);
			continue;
		}
		// An alias is what the statement calls the table, and is what a qualifier will be written
		// as: `o.` after `FROM orders o` means the columns of orders, whatever else is called `o`.
		resolved.byName.set(name, matches[0]);
		resolved.tables.push(matches[0]);
		if (table.altered || holdsAt(facts.changed, table.name, table.start)) {
			resolved.changed.add(name);
		}
	}

	return resolved;
}

/** Resolves a column written as an alias to the column the alias renames, if it can be found. */
function resolveAlias(
	column: { readonly name: string; readonly start: number; readonly end: number },
	scope: ResolvedScope,
): Reference | undefined {
	const renamed = scope.aliases.get(fold(column.name));
	if (!renamed) {
		return undefined;
	}
	let candidates = scope.tables;
	if (renamed.qualifier !== undefined) {
		const table = scope.byName.get(fold(renamed.qualifier));
		candidates = table ? [table] : [];
	}
	const owner = findOwner(candidates, renamed.name);
	if (!owner) {
		return undefined;
	}
	return {
		kind: 'column',
		name: column.name,
		start: column.start,
		end: column.end,
		status: 'resolved',
		table: owner,
		aliasOf: renamed.name,
		searched: [],
	};
}

function fold(name: string): string {
	return name.toLowerCase();
}
