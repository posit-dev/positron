/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Identifier quoting for the escape-hatch driver.
//
// The other data drivers each target one engine and can hard-code its quoting rules. ADBC
// cannot: the engine behind it is whatever the user has a driver for. Most engines follow
// the SQL standard and quote identifiers with double quotes, but a significant family
// (Databricks, Spark, Hive, MySQL, BigQuery) uses backticks and treats a double-quoted
// token as a *string literal* -- so `SELECT * FROM "t"` there is not a wrong-identifier
// error but a syntax error, or worse, a silently wrong query.
//
// The style is detected from what the driver reports about itself, with a user override
// for engines this file has not learned about yet.

/** How an engine delimits quoted identifiers. */
export type IdentifierQuoteStyle =
	/** The SQL standard: "name", embedded quotes doubled. PostgreSQL, SQLite, Snowflake, Trino. */
	| 'ansi'
	/** `name`, embedded backticks doubled. Databricks, Spark, Hive, MySQL, BigQuery. */
	| 'backtick'
	/** [name], embedded closing brackets doubled. Microsoft SQL Server. */
	| 'bracket';

/** The parameter value users pick to override detection; 'auto' defers to detectQuoteStyle. */
export type IdentifierQuoteSetting = IdentifierQuoteStyle | 'auto';

/**
 * Substrings that identify an engine in the backtick family. Matched case-insensitively
 * against everything we know about the connection (vendor name, driver name, and the
 * driver string the user configured), because no single one of those is reliably
 * populated across drivers.
 */
const BACKTICK_HINTS = ['databricks', 'spark', 'hive', 'mysql', 'mariadb', 'bigquery', 'singlestore'];

/** Substrings that identify Microsoft SQL Server, which uses bracket quoting. */
const BRACKET_HINTS = ['sql server', 'sqlserver', 'mssql', 'transact-sql', 'tsql'];

/**
 * What the driver reports about the engine it is connected to, used to pick a quoting
 * style. Every field is optional: GetInfo is optional in the ADBC spec, so a driver may
 * report neither vendor nor driver name, in which case only the configured driver string
 * (a short name like 'databricks', or a path to databricks.toml) is available.
 */
export interface DialectHints {
	/** ADBC InfoCode.VendorName, e.g. 'SQLite', 'Databricks'. */
	vendorName?: string;
	/** ADBC InfoCode.DriverName, e.g. 'ADBC SQLite Driver'. */
	driverName?: string;
	/** The driver string the user configured: a short name, a library path, or a manifest path. */
	configuredDriver?: string;
}

/**
 * Picks an identifier quoting style from what the driver reports. Defaults to the SQL
 * standard, which is correct for most engines and is the safer guess: on a backtick
 * engine it fails loudly with a syntax error rather than silently comparing against a
 * string literal.
 */
export function detectQuoteStyle(hints: DialectHints): IdentifierQuoteStyle {
	const haystack = [hints.vendorName, hints.driverName, hints.configuredDriver]
		.filter((value): value is string => typeof value === 'string')
		.join(' ')
		.toLowerCase();

	if (BRACKET_HINTS.some(hint => haystack.includes(hint))) {
		return 'bracket';
	}
	if (BACKTICK_HINTS.some(hint => haystack.includes(hint))) {
		return 'backtick';
	}
	return 'ansi';
}

/** Resolves the effective style from the user's setting, falling back to detection. */
export function resolveQuoteStyle(setting: IdentifierQuoteSetting, hints: DialectHints): IdentifierQuoteStyle {
	return setting === 'auto' ? detectQuoteStyle(hints) : setting;
}

/** Quotes an identifier in the given style, escaping the delimiter by doubling it. */
export function quoteIdentifierAs(name: string, style: IdentifierQuoteStyle): string {
	switch (style) {
		case 'backtick':
			return '`' + name.replace(/`/g, '``') + '`';
		case 'bracket':
			return '[' + name.replace(/]/g, ']]') + ']';
		case 'ansi':
		default:
			return '"' + name.replace(/"/g, '""') + '"';
	}
}

/** A bound identifier quoter, threaded through the table view so it stays dialect-agnostic. */
export type QuoteIdentifier = (name: string) => string;

/** Builds the quoter for a style. */
export function makeQuoteIdentifier(style: IdentifierQuoteStyle): QuoteIdentifier {
	return (name: string) => quoteIdentifierAs(name, style);
}
