/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConnectionRef, EMPTY_SCHEMA, SqlSchema, SqlTable } from './schema';

/**
 * The table metadata read from the user's connections, indexed for the lookups the editor
 * features run against it.
 *
 * Identifiers are matched case insensitively. Most engines fold unquoted identifiers to one case,
 * the case a connection reports is not necessarily the case the user typed, and a completion list
 * that goes empty because someone wrote `FROM customers` against a `CUSTOMERS` table is worse than
 * the rare wrong match on an engine that really is case sensitive.
 */
export class SchemaIndex {

	private readonly _byName = new Map<string, SqlTable[]>();

	/**
	 * Namespace parts that can qualify a table, e.g. the `sales` of `sales.orders`. Kept as a
	 * folded-name to display-case map, so completing a qualifier offers the case the connection
	 * uses rather than the case it was looked up by.
	 */
	private readonly _namespaces = new Map<string, string>();

	constructor(private readonly _schema: SqlSchema = EMPTY_SCHEMA) {
		for (const table of _schema.tables) {
			const key = fold(table.name);
			const existing = this._byName.get(key);
			if (existing) {
				existing.push(table);
			} else {
				this._byName.set(key, [table]);
			}

			for (const part of [table.catalog, table.schema]) {
				if (part && !this._namespaces.has(fold(part))) {
					this._namespaces.set(fold(part), part);
				}
			}
		}
	}

	public get tables(): readonly SqlTable[] {
		return this._schema.tables;
	}

	/**
	 * The connections these tables came from.
	 *
	 * What a message about a name should say it was looked for in: with a file scoped to one
	 * database, "not in the connected data connections" names a set of one and sounds like it
	 * searched more than it did.
	 */
	public get connections(): readonly ConnectionRef[] {
		return this._schema.connections;
	}

	/** Whether anything at all is known, which decides whether there is a list to offer. */
	public get isEmpty(): boolean {
		return this._schema.tables.length === 0;
	}

	/**
	 * Whether the schema is a full picture, and so can be used to judge a name unknown.
	 *
	 * A schema with no tables (nothing connected), or one where any connection it covers was read
	 * only in part (more tables than the node caps allow, or a read that failed), cannot tell a
	 * name that is wrong from one it simply never saw, and guessing wrong here means squiggles on
	 * SQL the user knows is correct.
	 */
	public get isComplete(): boolean {
		return !this.isEmpty && this._schema.incompleteProfiles.length === 0;
	}

	/** Whether a name is the catalog or schema of some known table. */
	public isNamespace(name: string): boolean {
		return this._namespaces.has(fold(name));
	}

	/** Every known table with the given unqualified name. */
	public tablesNamed(name: string): readonly SqlTable[] {
		return this._byName.get(fold(name)) ?? [];
	}

	/**
	 * Every known table matching a reference, which may name only part of its namespace.
	 *
	 * A reference that omits a namespace part matches tables regardless of that part, so
	 * `FROM orders` finds `sales.orders`. A reference that names one only matches tables that
	 * agree on it.
	 */
	public resolve(name: string, schema?: string, catalog?: string): readonly SqlTable[] {
		let matches = this.tablesNamed(name);
		if (schema !== undefined) {
			// Either level, because a two-part name is `schema.table` on most engines and
			// `catalog.table` on the ones with no schema level at all.
			matches = matches.filter(table =>
				fold(table.schema ?? '') === fold(schema) || fold(table.catalog ?? '') === fold(schema));
		}
		if (catalog !== undefined) {
			matches = matches.filter(table => fold(table.catalog ?? '') === fold(catalog));
		}
		return matches;
	}

	/** Every known table whose catalog or schema is the given name. */
	public tablesInNamespace(name: string): readonly SqlTable[] {
		return this._schema.tables.filter(table =>
			fold(table.schema ?? '') === fold(name) || fold(table.catalog ?? '') === fold(name));
	}
}

/** The dotted name of a table, using whichever namespace parts the connection reported. */
export function qualifiedName(table: SqlTable): string {
	return [table.catalog, table.schema, table.name].filter(part => part).join('.');
}

function fold(name: string): string {
	return name.toLowerCase();
}
