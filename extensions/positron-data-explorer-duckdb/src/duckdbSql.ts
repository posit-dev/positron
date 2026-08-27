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
