/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Quotes and escapes an identifier for DuckDB by doubling embedded double-quotes. */
export function quoteIdentifier(name: string): string {
	return '"' + name.replace(/"/g, '""') + '"';
}

/** Escapes a value for use inside a single-quoted DuckDB string literal. */
export function quoteLiteral(value: string): string {
	return value.replace(/'/g, '\'\'');
}

/**
 * Returns the SQL expression that names the catalog a metadata query targets, plus the parameters
 * to bind. A named database is bound as `$database`; `undefined` targets the current database. No
 * query string is built from a database name.
 */
export function catalogFilter(database: string | undefined): { expr: string; params: Record<string, string> } {
	return database === undefined
		? { expr: 'current_database()', params: {} }
		: { expr: '$database', params: { database } };
}
