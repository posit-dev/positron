/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildConnectionString, parseConnectionString, redactConnectionString } from '../odbcConnectionString.js';
import { createOdbcDrivers, GENERIC_ODBC_DRIVER_ID } from '../odbcDriver.js';
import { DEFAULT_DIALECT, findDatabaseProfile, groupDriversByDatabase, resolveDialect } from '../odbcDatabases.js';
import { OdbcConfiguration } from '../odbcinst.js';

// A no-op Data Explorer host: these tests exercise driver construction and code generation, not
// previewing, and a real handler would register a provider that collides with the activated
// extension's.
const noopHost = {
	openTableView: async () => { },
	openColumnView: async () => { },
	closeTableView: () => { },
};

/** The extension context, needed only so the driver can read its icon off disk. */
function testContext(): vscode.ExtensionContext {
	const extension = vscode.extensions.getExtension('positron.positron-data-driver-odbc');
	assert.ok(extension, 'the ODBC driver extension should be present');
	// eslint-disable-next-line local/code-no-any-casts
	return { extensionPath: extension.extensionPath } as any;
}

function driverEntry(name: string) {
	return { name, driverPath: `/usr/lib/${name}.so`, scope: 'system' as const, attributes: {} };
}

function dsnEntry(name: string, driverName: string, attributes: Record<string, string> = {}) {
	return { name, driverName, scope: 'user' as const, attributes: { driver: driverName, ...attributes } };
}

const CONFIG: OdbcConfiguration = {
	drivers: [
		driverEntry('PostgreSQL Unicode'),
		driverEntry('MySQL ODBC 8.0 Unicode Driver'),
		driverEntry('MySQL ODBC 8.0 ANSI Driver'),
	],
	dsns: [dsnEntry('Pagila', 'PostgreSQL Unicode', { servername: 'localhost', port: '5432', database: 'pagila' })],
	sources: ['/etc/odbcinst.ini'],
};

suite('connection strings', () => {
	test('brace-wraps the driver name and any value that needs it, and round-trips them', () => {
		const connectionString = buildConnectionString([
			['Driver', 'PostgreSQL Unicode'],
			['Servername', 'localhost'],
			['PWD', 'p;a}ss'],
			['Empty', ''],
			['Missing', undefined],
		]);

		assert.strictEqual(connectionString, 'Driver={PostgreSQL Unicode};Servername=localhost;PWD={p;a}}ss}');
		assert.deepStrictEqual(parseConnectionString(connectionString), {
			driver: 'PostgreSQL Unicode',
			servername: 'localhost',
			pwd: 'p;a}ss',
		});
	});

	test('braces a value carrying an ODBC special character, and never braces twice', () => {
		// "(x64)" is the case that matters: 64-bit Windows driver names routinely carry it, and the
		// parentheses oblige the value to be brace-wrapped.
		const connectionString = buildConnectionString([
			['Driver', 'PostgreSQL Unicode(x64)'],
			['DSN', 'Plain'],
			['Extra', 'a=b'],
		]);

		assert.strictEqual(connectionString, 'Driver={PostgreSQL Unicode(x64)};DSN=Plain;Extra={a=b}');
		assert.deepStrictEqual(parseConnectionString(connectionString), {
			driver: 'PostgreSQL Unicode(x64)',
			dsn: 'Plain',
			extra: 'a=b',
		});
	});

	test('redacts an embedded password in place, leaving the rest of the string as typed', () => {
		assert.deepStrictEqual(
			{
				withPassword: redactConnectionString('DSN=Pagila;UID=brian;PWD=hunter2'),
				withoutPassword: redactConnectionString('DSN=Pagila;UID=brian'),
				// The surrounding text keeps its own capitalization, spacing, and bracing, and a
				// brace-wrapped password is consumed whole rather than up to the first semicolon.
				verbatim: redactConnectionString('Driver={PostgreSQL Unicode}; uid = brian ; Password={p;a}}ss};Extra=1'),
			},
			{
				withPassword: 'DSN=Pagila;UID=brian;PWD=****',
				withoutPassword: 'DSN=Pagila;UID=brian',
				verbatim: 'Driver={PostgreSQL Unicode}; uid = brian ; Password=****;Extra=1',
			}
		);
	});
});

suite('database profiles', () => {
	test('matches driver names to databases, preferring the more specific pattern', () => {
		assert.deepStrictEqual(
			[
				'MySQL ODBC 8.0 Unicode Driver',
				'MariaDB ODBC 3.1 Driver',
				'ODBC Driver 18 for SQL Server',
				'Simba Snowflake ODBC Driver',
				'Some Unknown Driver',
			].map(name => findDatabaseProfile(name)?.id),
			['mysql', 'mariadb', 'sqlserver', 'snowflake', undefined]
		);
	});

	test('resolves dialects, falling back to the SQL standard for an unknown driver', () => {
		assert.deepStrictEqual(
			{
				mysql: resolveDialect('MySQL ODBC 8.0 Unicode Driver'),
				sqlserver: resolveDialect('ODBC Driver 18 for SQL Server'),
				postgres: resolveDialect('PostgreSQL Unicode'),
				unknown: resolveDialect('Some Unknown Driver'),
			},
			{
				mysql: { identifierQuote: '`', pagination: 'limit-offset' },
				sqlserver: { identifierQuote: '"', pagination: 'offset-fetch' },
				postgres: { identifierQuote: '"', pagination: 'limit-offset' },
				unknown: DEFAULT_DIALECT,
			}
		);
	});

	test('groups installed drivers by database, excluding those with a native Positron driver', () => {
		assert.deepStrictEqual(
			groupDriversByDatabase(CONFIG.drivers).map(group => ({
				id: group.profile.id,
				drivers: group.drivers.map(driver => driver.name),
			})),
			// PostgreSQL is excluded: Positron ships a native driver for it, and a second
			// "PostgreSQL" entry in the New Connection list would be worse than useless.
			[{ id: 'mysql', drivers: ['MySQL ODBC 8.0 Unicode Driver', 'MySQL ODBC 8.0 ANSI Driver'] }]
		);
	});
});

suite('createOdbcDrivers', () => {
	test('registers the generic driver plus one per recognized database', () => {
		const drivers = createOdbcDrivers(testContext(), CONFIG, noopHost);

		assert.deepStrictEqual(
			drivers.map(driver => ({ id: driver.id, name: driver.name, mechanisms: driver.mechanisms.map(m => m.id) })),
			[
				{ id: GENERIC_ODBC_DRIVER_ID, name: 'ODBC', mechanisms: ['dsn', 'driver', 'connectionString'] },
				// The per-database driver offers no DSN mechanism: data sources belong to the
				// generic driver, so they appear in the pane exactly once.
				{ id: `${GENERIC_ODBC_DRIVER_ID}-mysql`, name: 'MySQL', mechanisms: ['driver', 'connectionString'] },
			]
		);
	});

	test('offers only the connection-string mechanism when nothing was discovered', () => {
		const drivers = createOdbcDrivers(testContext(), { drivers: [], dsns: [], sources: [] }, noopHost);

		assert.deepStrictEqual(
			drivers.map(driver => ({ id: driver.id, mechanisms: driver.mechanisms.map(m => m.id) })),
			[{ id: GENERIC_ODBC_DRIVER_ID, mechanisms: ['connectionString'] }]
		);
	});

	test('reports every DSN as a discovered connection, from the generic driver only', async () => {
		const drivers = createOdbcDrivers(testContext(), CONFIG, noopHost);

		assert.deepStrictEqual(
			await Promise.all(drivers.map(async driver => ({
				id: driver.id,
				discovered: await driver.discoverConnections!(),
			}))),
			[
				{
					id: GENERIC_ODBC_DRIVER_ID,
					discovered: [{
						id: 'odbc-dsn:Pagila',
						name: 'Pagila',
						description: 'localhost:5432/pagila',
						mechanismId: 'dsn',
						parameters: { dsn: 'Pagila' },
					}],
				},
				{ id: `${GENERIC_ODBC_DRIVER_ID}-mysql`, discovered: [] },
			]
		);
	});

	test('generates R and Python code from each mechanism', async () => {
		const [generic] = createOdbcDrivers(testContext(), CONFIG, noopHost);

		const rFromDsn = await generic.generateConnectionCode!('dsn', 'r', { dsn: 'Pagila', user: 'brian' });
		const pythonFromDriver = await generic.generateConnectionCode!('driver', 'python', {
			odbcDriver: 'PostgreSQL Unicode',
			server: 'localhost',
			port: 5432,
			database: 'pagila',
			user: 'brian',
			password: 'hunter2',
		});

		assert.deepStrictEqual(
			{
				rVariants: rFromDsn.map(variant => variant.id),
				rCode: rFromDsn[0].code,
				pythonVariants: pythonFromDriver.map(variant => variant.id),
				pythonCode: pythonFromDriver[0].code,
			},
			{
				rVariants: ['dbi'],
				rCode: 'library(DBI)\n\ncon <- dbConnect(\n\todbc::odbc(),\n\t.connection_string = "DSN=Pagila;UID=brian"\n)\n',
				pythonVariants: ['pyodbc', 'sqlalchemy'],
				// The PostgreSQL profile's attribute names are used, not the generic fallback:
				// psqlodbc wants Servername, not Server.
				pythonCode: 'import pyodbc\n\nconn = pyodbc.connect("Driver={PostgreSQL Unicode};Servername=localhost;Port=5432;Database=pagila;UID=brian;PWD=hunter2")\n',
			}
		);
	});

	test('generates nothing when a required parameter is missing, and redacts only the connection string', async () => {
		const [generic] = createOdbcDrivers(testContext(), CONFIG, noopHost);

		assert.deepStrictEqual(
			{
				noServer: await generic.generateConnectionCode!('driver', 'r', { odbcDriver: 'PostgreSQL Unicode' }),
				unsupportedLanguage: await generic.generateConnectionCode!('dsn', 'julia', { dsn: 'Pagila' }),
				redactedString: generic.redactParameterValue!('connectionString', 'connectionString', 'DSN=Pagila;PWD=hunter2'),
				redactedOther: generic.redactParameterValue!('dsn', 'password', 'hunter2'),
			},
			{
				noServer: [],
				unsupportedLanguage: [],
				redactedString: 'DSN=Pagila;PWD=****',
				redactedOther: undefined,
			}
		);
	});
});
