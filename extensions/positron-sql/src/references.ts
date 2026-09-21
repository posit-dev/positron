/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Analysis, Scope } from './analyzer';
import { SqlTable } from './schema';
import { qualifiedName, SchemaIndex } from './schemaIndex';

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
}

/** Finds every table and column name in a parsed document and resolves it against the schema. */
export function resolveReferences(analysis: Analysis, schema: SchemaIndex): Reference[] {
	const references: Reference[] = [];
	const scopes = analysis.scopes.map((_, index) => resolveScope(index, analysis, schema));

	for (const table of analysis.tables) {
		// A CTE, a derived table, or the object a CREATE is defining. All three are correct SQL
		// that names nothing in the database, so none of them is a name to check.
		if (table.local || table.definition) {
			continue;
		}
		const matches = schema.resolve(table.name, table.schema, table.catalog);
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
		const scope = scopes[column.scope];
		if (!scope) {
			continue;
		}

		let candidates: SqlTable[];
		if (column.qualifier !== undefined) {
			if (scope.unresolvable.has(fold(column.qualifier))) {
				// The qualifier names something this cannot see into, or a table the schema does
				// not have. Either way the column below it is not a second mistake, and a second
				// squiggle would be one mistake reported twice.
				continue;
			}
			const table = scope.byName.get(fold(column.qualifier));
			if (!table) {
				continue;
			}
			candidates = [table];
		} else if (scope.unresolvable.has(fold(column.name))) {
			// A name the statement made up rather than read from a table: the alias of a select
			// item that an `ORDER BY` refers back to, or a CTE. Looking one up in the schema finds
			// nothing, and saying so would flag `SELECT total AS t FROM orders ORDER BY t`, which
			// is ordinary SQL.
			continue;
		} else if (scope.opaque || scope.tables.length === 0) {
			continue;
		} else {
			candidates = scope.tables;
		}

		const owner = candidates.find(table =>
			table.columns.some(item => fold(item.name) === fold(column.name)));
		references.push({
			kind: 'column',
			name: column.name,
			start: column.start,
			end: column.end,
			status: owner ? 'resolved' : 'unknown',
			table: owner,
			searched: owner ? [] : candidates.map(qualifiedName),
		});
	}

	references.sort((left, right) => left.start - right.start);
	return references;
}

function resolveScope(index: number, analysis: Analysis, schema: SchemaIndex): ResolvedScope {
	const scope = analysis.scopes[index];
	const resolved: ResolvedScope = {
		byName: new Map(),
		tables: [],
		opaque: scope.opaque,
		unresolvable: new Set(),
	};

	// Names the statement defines for itself, at this level and every level enclosing it. A CTE
	// declared at the top of a statement is in scope for a subquery six levels down.
	for (let at: number | undefined = index; at !== undefined;) {
		const enclosing: Scope | undefined = analysis.scopes[at];
		if (!enclosing) {
			break;
		}
		for (const local of enclosing.locals) {
			resolved.unresolvable.add(fold(local));
		}
		at = enclosing.parent;
	}

	for (const index of scope.tables) {
		const table = analysis.tables[index];
		if (!table) {
			continue;
		}
		const name = table.alias ?? table.name;
		const matches = schema.resolve(table.name, table.schema, table.catalog);
		if (matches.length === 0) {
			// Reported as an unknown table in its own right; its columns could be anything.
			resolved.opaque = true;
			resolved.unresolvable.add(fold(name));
			continue;
		}
		// An alias is what the statement calls the table, and is what a qualifier will be written
		// as: `o.` after `FROM orders o` means the columns of orders, whatever else is called `o`.
		resolved.byName.set(fold(name), matches[0]);
		resolved.tables.push(matches[0]);
	}

	return resolved;
}

function fold(name: string): string {
	return name.toLowerCase();
}
