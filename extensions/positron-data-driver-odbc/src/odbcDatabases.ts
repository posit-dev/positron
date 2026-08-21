/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A curated map from ODBC driver names to the database behind them.
//
// It does two jobs. It tells the Data Explorer how to write SQL for a connection (quoting and
// row-limiting differ per backend, and node-odbc exposes no SQLGetInfo to ask at runtime), and it
// lets the extension offer a per-database entry -- "MySQL" rather than "ODBC" -- for each
// recognized ODBC driver installed on the machine.
//
// Matching is on the ODBC driver's *name* as it appears in odbcinst.ini, because that is all we
// have. Vendors are not consistent about it ("MySQL ODBC 8.0 Unicode Driver", "Simba Snowflake",
// "Posit Snowflake"), so each entry carries several patterns and an unrecognized driver simply
// falls back to the conservative default.

import { OdbcDriverEntry } from './odbcinst';

/** How to write SQL for a backend. */
export interface OdbcDialect {
	/**
	 * The character delimiting an identifier. SQL-92 says `"`; MySQL and the Hive family use a
	 * backtick unless configured otherwise.
	 */
	readonly identifierQuote: string;

	/**
	 * How the backend spells "rows m..m+n of this result".
	 * - `limit-offset`: `LIMIT n OFFSET m` (MySQL, PostgreSQL, Snowflake, Hive).
	 * - `offset-fetch`: `OFFSET m ROWS FETCH NEXT n ROWS ONLY`, the SQL:2008 form (SQL Server
	 *   2012+, Oracle 12c+, DB2, Teradata). The default for unrecognized drivers, being the
	 *   standard one.
	 */
	readonly pagination: 'limit-offset' | 'offset-fetch';
}

/** The conservative dialect used for any ODBC driver we do not recognize. */
export const DEFAULT_DIALECT: OdbcDialect = {
	identifierQuote: '"',
	pagination: 'offset-fetch',
};

/** A database reachable over ODBC, and how to talk to it. */
export interface OdbcDatabaseProfile {
	/** Stable id, used to build the per-database Positron driver id. */
	readonly id: string;

	/** The user-facing database name, e.g. "MySQL". */
	readonly name: string;

	/** Patterns matched case-insensitively against the ODBC driver name. */
	readonly driverNamePatterns: readonly RegExp[];

	/** The dialect the Data Explorer writes SQL in. */
	readonly dialect: OdbcDialect;

	/** The default TCP port, offered as the port parameter's default. */
	readonly defaultPort?: number;

	/**
	 * The connection-string attribute names this database's ODBC drivers expect. Not standardized
	 * across vendors -- SQL Server wants `Server`, PostgreSQL wants `Servername`, and so on.
	 */
	readonly attributeKeys: {
		readonly server: string;
		readonly port?: string;
		readonly database?: string;
		readonly user: string;
		readonly password: string;
	};

	/**
	 * Whether to register a per-database Positron driver for this database when its ODBC driver is
	 * installed. False where Positron already ships a native driver (PostgreSQL, Snowflake,
	 * Databricks, Redshift, SQLite): a second entry with the same name in the New Connection list
	 * would be worse than useless. Those databases still get a dialect, since they are reachable
	 * through the generic ODBC entry.
	 */
	readonly registerDriver: boolean;
}

const LIMIT_OFFSET: OdbcDialect = { identifierQuote: '"', pagination: 'limit-offset' };
const BACKTICK_LIMIT_OFFSET: OdbcDialect = { identifierQuote: '`', pagination: 'limit-offset' };

/**
 * The curated list. Order matters: the first profile whose pattern matches wins, so more specific
 * patterns must precede more general ones (MariaDB before MySQL, since MariaDB's driver name
 * frequently mentions both).
 */
export const ODBC_DATABASE_PROFILES: readonly OdbcDatabaseProfile[] = [
	{
		id: 'mariadb',
		name: 'MariaDB',
		driverNamePatterns: [/mariadb/i],
		dialect: BACKTICK_LIMIT_OFFSET,
		defaultPort: 3306,
		attributeKeys: { server: 'Server', port: 'Port', database: 'Database', user: 'User', password: 'Password' },
		registerDriver: true,
	},
	{
		id: 'mysql',
		name: 'MySQL',
		driverNamePatterns: [/mysql/i],
		dialect: BACKTICK_LIMIT_OFFSET,
		defaultPort: 3306,
		attributeKeys: { server: 'Server', port: 'Port', database: 'Database', user: 'User', password: 'Password' },
		registerDriver: true,
	},
	{
		id: 'sqlserver',
		name: 'SQL Server',
		// "ODBC Driver 18 for SQL Server", "SQL Server Native Client 11.0", "Posit SQL Server".
		driverNamePatterns: [/sql\s*server/i, /msodbcsql/i],
		dialect: { identifierQuote: '"', pagination: 'offset-fetch' },
		// No port key and no defaultPort: Microsoft's driver has no Port connection-string keyword.
		// The port goes inside Server, comma-separated -- `Server=myhost,1433`. A port key here
		// would emit an attribute the driver ignores, failing the connection with nothing in the
		// form to explain why.
		attributeKeys: { server: 'Server', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'oracle',
		name: 'Oracle',
		driverNamePatterns: [/oracle/i],
		dialect: { identifierQuote: '"', pagination: 'offset-fetch' },
		defaultPort: 1521,
		attributeKeys: { server: 'Server', port: 'Port', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'teradata',
		name: 'Teradata',
		driverNamePatterns: [/teradata/i],
		dialect: { identifierQuote: '"', pagination: 'offset-fetch' },
		attributeKeys: { server: 'DBCName', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'hive',
		name: 'Hive',
		driverNamePatterns: [/hive/i],
		dialect: BACKTICK_LIMIT_OFFSET,
		defaultPort: 10000,
		attributeKeys: { server: 'Host', port: 'Port', database: 'Schema', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'impala',
		name: 'Impala',
		driverNamePatterns: [/impala/i],
		dialect: BACKTICK_LIMIT_OFFSET,
		defaultPort: 21050,
		attributeKeys: { server: 'Host', port: 'Port', database: 'Schema', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'db2',
		name: 'Db2',
		driverNamePatterns: [/\bdb2\b/i],
		dialect: { identifierQuote: '"', pagination: 'offset-fetch' },
		defaultPort: 50000,
		attributeKeys: { server: 'Hostname', port: 'Port', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},
	{
		id: 'bigquery',
		name: 'BigQuery',
		driverNamePatterns: [/bigquery/i],
		dialect: LIMIT_OFFSET,
		attributeKeys: { server: 'Server', database: 'Catalog', user: 'UID', password: 'PWD' },
		registerDriver: true,
	},

	// --- Databases Positron already has a native driver for. Dialect only; no second entry in the
	// New Connection list. ---
	{
		id: 'postgresql',
		name: 'PostgreSQL',
		driverNamePatterns: [/postgres/i, /psqlodbc/i],
		dialect: LIMIT_OFFSET,
		defaultPort: 5432,
		attributeKeys: { server: 'Servername', port: 'Port', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: false,
	},
	{
		id: 'redshift',
		name: 'Redshift',
		driverNamePatterns: [/redshift/i],
		dialect: LIMIT_OFFSET,
		defaultPort: 5439,
		attributeKeys: { server: 'Server', port: 'Port', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: false,
	},
	{
		id: 'snowflake',
		name: 'Snowflake',
		driverNamePatterns: [/snowflake/i],
		dialect: LIMIT_OFFSET,
		attributeKeys: { server: 'Server', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: false,
	},
	{
		id: 'databricks',
		name: 'Databricks',
		driverNamePatterns: [/databricks/i, /spark/i],
		dialect: BACKTICK_LIMIT_OFFSET,
		defaultPort: 443,
		attributeKeys: { server: 'Host', port: 'Port', database: 'Schema', user: 'UID', password: 'PWD' },
		registerDriver: false,
	},
	{
		id: 'sqlite',
		name: 'SQLite',
		driverNamePatterns: [/sqlite/i],
		dialect: LIMIT_OFFSET,
		attributeKeys: { server: 'Server', database: 'Database', user: 'UID', password: 'PWD' },
		registerDriver: false,
	},
];

/**
 * Finds the database profile for an ODBC driver name, or undefined when the name matches none of
 * the curated patterns.
 * @param driverName The ODBC driver name as it appears in odbcinst.ini.
 */
export function findDatabaseProfile(driverName: string | undefined): OdbcDatabaseProfile | undefined {
	if (driverName === undefined) {
		return undefined;
	}
	return ODBC_DATABASE_PROFILES.find(profile =>
		profile.driverNamePatterns.some(pattern => pattern.test(driverName)));
}

/**
 * Resolves the dialect for an ODBC driver name, falling back to the SQL-92 / SQL:2008 default for
 * anything unrecognized.
 * @param driverName The ODBC driver name as it appears in odbcinst.ini.
 */
export function resolveDialect(driverName: string | undefined): OdbcDialect {
	return findDatabaseProfile(driverName)?.dialect ?? DEFAULT_DIALECT;
}

/**
 * Groups the installed ODBC drivers by the database they serve, for the per-database Positron
 * drivers. Only profiles marked `registerDriver` are returned, and only when at least one matching
 * ODBC driver is actually installed -- the New Connection list should offer a database only when
 * the machine can reach it.
 * @param drivers The ODBC drivers discovered on this machine.
 */
export function groupDriversByDatabase(
	drivers: readonly OdbcDriverEntry[]
): Array<{ profile: OdbcDatabaseProfile; drivers: OdbcDriverEntry[] }> {
	const grouped = new Map<string, { profile: OdbcDatabaseProfile; drivers: OdbcDriverEntry[] }>();

	for (const driver of drivers) {
		const profile = findDatabaseProfile(driver.name);
		if (profile === undefined || !profile.registerDriver) {
			continue;
		}
		const existing = grouped.get(profile.id);
		if (existing) {
			existing.drivers.push(driver);
		} else {
			grouped.set(profile.id, { profile, drivers: [driver] });
		}
	}

	return [...grouped.values()].sort((a, b) => a.profile.name.localeCompare(b.profile.name));
}
