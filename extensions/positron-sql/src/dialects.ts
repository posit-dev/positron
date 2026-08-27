/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * What database a data connection driver connects to, and therefore how to read the SQL written
 * against it.
 *
 * By driver id, because that is all a connection reports: `DataConnectionSummary` carries no
 * dialect and no "is this SQL at all" flag, and driver metadata's `supportedLanguageIds` is about
 * generating R and Python connection code, which every driver does including the ones that are not
 * databases. If the API ever grows a dialect of its own, this table is what it replaces.
 *
 * Unknown drivers are assumed to be SQL databases of an unknown dialect. A third-party driver is
 * far more likely to be a database Positron has not heard of than not a database at all, and the
 * generic dialect reads it about as well as anything: guessing wrong the other way would leave a
 * user with no completions and nothing to say why.
 */

/** Positron's own drivers, whose ids are all of this form. */
const DRIVER_PREFIX = 'positron-data-driver-';

/**
 * The ODBC drivers, which are registered one per database recognized plus a generic one, as
 * `positron-data-driver-odbc-postgresql` and so on. The database after the prefix is the same key
 * as a native driver's, so both spellings reach the same row below.
 */
const ODBC_PREFIX = 'odbc-';

/**
 * Databases that hold no tables and answer no SQL.
 *
 * A Posit Connect pin is a stored R or Python object -- a data frame, a model, a plot. The
 * Connections pane browses them because they are data the user has, not because they can be
 * selected from, so a SQL file must not be written against one and must not complete from one.
 */
const NOT_SQL = new Set(['pins']);

/**
 * The dialect each database speaks, named the way the `sql.dialect` setting names it.
 *
 * Every database is listed, including the ones whose dialect is spelled the same, so that adding
 * a driver is one obvious edit. A name not in this table resolves to the generic dialect rather
 * than being passed through as a dialect: a driver id that happens to look like a dialect would
 * otherwise reach the parser, which would report a dialect the user never chose as unrecognized.
 */
const DIALECTS = new Map([
	['bigquery', 'bigquery'],
	['databricks', 'databricks'],
	['duckdb', 'duckdb'],
	['hive', 'hive'],
	// Impala has no dialect of its own here. Hive is the closest relative that gets the important
	// part right: backtick quoting, which decides how a completion inserts an awkward name.
	['impala', 'hive'],
	['mariadb', 'mariadb'],
	['mysql', 'mysql'],
	['oracle', 'oracle'],
	['postgresql', 'postgres'],
	['redshift', 'redshift'],
	['snowflake', 'snowflake'],
	['sqlite', 'sqlite'],
	['sqlserver', 'tsql'],
	['teradata', 'teradata'],
	// Left generic on purpose: DB2 has no parser here and no close relative, and the generic
	// dialect accepts a superset rather than reporting errors on SQL that is fine.
	['db2', ''],
	// The generic ODBC driver connects to whatever the user's driver manager offers, which is not
	// known from the id.
	['odbc', ''],
]);

/**
 * What each dialect is called, matching the labels the `sql.dialect` setting lists.
 *
 * Kept here rather than read back out of the manifest, which holds them for the settings editor
 * and in a shape (two parallel arrays, one entry an NLS placeholder) that is worse to read than
 * to repeat. Adding a dialect to the setting means adding it here.
 */
const DIALECT_NAMES = new Map([
	['ansi', 'ANSI SQL'],
	['athena', 'Athena'],
	['bigquery', 'BigQuery'],
	['clickhouse', 'ClickHouse'],
	['databricks', 'Databricks'],
	['duckdb', 'DuckDB'],
	['hive', 'Hive'],
	['mariadb', 'MariaDB'],
	['mysql', 'MySQL'],
	['oracle', 'Oracle'],
	['postgres', 'PostgreSQL'],
	['presto', 'Presto'],
	['redshift', 'Redshift'],
	['snowflake', 'Snowflake'],
	['spark', 'Spark SQL'],
	['sqlite', 'SQLite'],
	['teradata', 'Teradata'],
	['trino', 'Trino'],
	['tsql', 'Transact-SQL'],
]);

/**
 * The name to show for a dialect, or undefined when there is no particular one to name.
 *
 * Undefined covers both the empty default and a name nothing here recognizes, because they are
 * the same thing to the parser: it falls back to the permissive generic dialect either way, and a
 * display that named the user's typo would claim it was in use.
 */
export function dialectName(dialect: string): string | undefined {
	return DIALECT_NAMES.get(dialect);
}

/**
 * Whether SQL can be written against a connection made with this driver.
 *
 * Decides both what the schema is read from and what the connection picker offers: a connection a
 * file cannot be written against should not be listed as one it could be.
 */
export function supportsSql(driverId: string): boolean {
	return !NOT_SQL.has(databaseOf(driverId));
}

/**
 * The dialect to parse a file written against this driver, or `''` for the generic dialect.
 *
 * `''` covers both "this driver connects to something whose dialect is not known from its id" and
 * "no driver at all", which want the same treatment: parse permissively rather than report errors
 * against a dialect nobody chose.
 */
export function dialectOfDriver(driverId: string): string {
	return DIALECTS.get(databaseOf(driverId)) ?? '';
}

/** The database a driver id names, with Positron's prefixes taken off. */
function databaseOf(driverId: string): string {
	const withoutPrefix = driverId.startsWith(DRIVER_PREFIX)
		? driverId.slice(DRIVER_PREFIX.length)
		: driverId;
	return withoutPrefix.startsWith(ODBC_PREFIX) && withoutPrefix !== ODBC_PREFIX
		? withoutPrefix.slice(ODBC_PREFIX.length)
		: withoutPrefix;
}
