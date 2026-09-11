/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	discoverOdbcConfiguration,
	IOdbcConfigHost,
	OdbcRegistrySnapshot,
	parseIni,
	resolveUnixConfigPaths,
	summarizeDsn,
} from '../odbcinst.js';
import { parseRegQueryOutput } from '../odbcConfigHost.js';

/**
 * Builds a test host over a map of path -> file contents. Every path present in the map exists;
 * driver library paths are declared separately via `existingPaths` so a fixture can model an
 * odbcinst.ini entry whose library has been uninstalled.
 */
function createTestHost(options: {
	files?: Record<string, string>;
	existingPaths?: string[];
	env?: Record<string, string>;
	home?: string;
	platform?: NodeJS.Platform;
	registry?: OdbcRegistrySnapshot;
}): IOdbcConfigHost {
	const files = options.files ?? {};
	const existing = new Set([...Object.keys(files), ...(options.existingPaths ?? [])]);
	return {
		platform: options.platform ?? 'linux',
		readFile: (filePath) => files[filePath],
		exists: (filePath) => existing.has(filePath),
		homeDir: () => options.home ?? '/home/brian',
		env: (name) => options.env?.[name],
		readRegistry: () => options.registry,
	};
}

suite('parseIni', () => {
	test('parses sections, lowercases keys, and ignores comments', () => {
		const parsed = parseIni([
			'; a comment',
			'# another comment',
			'[PostgreSQL Unicode]',
			'Description = PostgreSQL driver',
			'DRIVER = /usr/lib/psqlodbcw.so',
			'',
			'[Pagila]',
			'  Servername  =  localhost  ',
			'Port=5432',
		].join('\n'));

		assert.deepStrictEqual(parsed, {
			'PostgreSQL Unicode': {
				description: 'PostgreSQL driver',
				driver: '/usr/lib/psqlodbcw.so',
			},
			'Pagila': {
				servername: 'localhost',
				port: '5432',
			},
		});
	});

	test('keeps a value containing an equals sign intact and merges repeated sections', () => {
		const parsed = parseIni([
			'[Snowflake]',
			'Driver = /opt/snowflake/lib/libSnowflake.dylib',
			'[Snowflake]',
			'Options = a=1;b=2',
			'no-equals-line',
		].join('\n'));

		assert.deepStrictEqual(parsed, {
			Snowflake: {
				driver: '/opt/snowflake/lib/libSnowflake.dylib',
				options: 'a=1;b=2',
			},
		});
	});
});

suite('resolveUnixConfigPaths', () => {
	test('defaults to the standard system directories and the per-user dotfiles', () => {
		const paths = resolveUnixConfigPaths(createTestHost({ home: '/home/brian' }));

		assert.deepStrictEqual(paths, {
			// /etc/unixODBC is the SUSE-family SYSCONFDIR; openSUSE Leap ships unixODBC built
			// that way, so omitting it hides every system DSN on that platform.
			systemDrivers: ['/etc/odbcinst.ini', '/etc/unixODBC/odbcinst.ini', '/usr/local/etc/odbcinst.ini', '/opt/homebrew/etc/odbcinst.ini'],
			systemDsns: ['/etc/odbc.ini', '/etc/unixODBC/odbc.ini', '/usr/local/etc/odbc.ini', '/opt/homebrew/etc/odbc.ini'],
			userDrivers: ['/home/brian/.odbcinst.ini'],
			userDsns: ['/home/brian/.odbc.ini'],
		});
	});

	test('honors ODBCSYSINI, ODBCINSTINI, and ODBCINI', () => {
		const paths = resolveUnixConfigPaths(createTestHost({
			home: '/home/brian',
			env: {
				ODBCSYSINI: '/opt/odbc',
				ODBCINSTINI: 'drivers.ini',
				ODBCINI: '/opt/odbc/mine.ini',
			},
		}));

		assert.deepStrictEqual(paths, {
			systemDrivers: ['/opt/odbc/drivers.ini'],
			systemDsns: ['/opt/odbc/odbc.ini'],
			userDrivers: ['/home/brian/.odbcinst.ini'],
			userDsns: ['/opt/odbc/mine.ini'],
		});
	});

	test('treats an absolute ODBCINSTINI as the driver file outright', () => {
		const paths = resolveUnixConfigPaths(createTestHost({
			env: { ODBCSYSINI: '/opt/odbc', ODBCINSTINI: '/etc/elsewhere/drivers.ini' },
		}));

		assert.deepStrictEqual(paths.systemDrivers, ['/etc/elsewhere/drivers.ini']);
	});
});

suite('discoverOdbcConfiguration (unix)', () => {
	test('reads drivers and DSNs, drops entries whose library is gone, and lets user entries win', () => {
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			home: '/home/brian',
			files: {
				'/etc/odbcinst.ini': [
					'[PostgreSQL Unicode]',
					'Description = System PostgreSQL',
					'Driver = /usr/lib/psqlodbcw.so',
					'',
					'[Uninstalled Driver]',
					'Driver = /gone/libgone.so',
					'',
					'[ODBC Drivers]',
					'PostgreSQL Unicode = Installed',
				].join('\n'),
				'/home/brian/.odbcinst.ini': [
					'[PostgreSQL Unicode]',
					'Description = My PostgreSQL',
					'Driver = /usr/lib/psqlodbcw.so',
				].join('\n'),
				'/etc/odbc.ini': [
					'[Pagila]',
					'Driver = PostgreSQL Unicode',
					'Servername = localhost',
					'Port = 5432',
					'Database = pagila',
				].join('\n'),
				'/home/brian/.odbc.ini': [
					'[Mine]',
					'Driver = PostgreSQL Unicode',
					'Servername = db.example.com',
					'Database = analytics',
				].join('\n'),
			},
			existingPaths: ['/usr/lib/psqlodbcw.so'],
		}));

		assert.deepStrictEqual(
			config.drivers.map(driver => ({ name: driver.name, description: driver.description, scope: driver.scope })),
			// "Uninstalled Driver" is dropped: its library does not exist. "PostgreSQL Unicode"
			// carries the user file's description, since a user entry shadows the system one.
			[{ name: 'PostgreSQL Unicode', description: 'My PostgreSQL', scope: 'user' }]
		);

		assert.deepStrictEqual(
			config.dsns.map(dsn => ({ name: dsn.name, driverName: dsn.driverName, scope: dsn.scope, summary: summarizeDsn(dsn) })),
			[
				{ name: 'Mine', driverName: 'PostgreSQL Unicode', scope: 'user', summary: 'db.example.com/analytics' },
				{ name: 'Pagila', driverName: 'PostgreSQL Unicode', scope: 'system', summary: 'localhost:5432/pagila' },
			]
		);
	});

	test('keeps a driverless entry and reports no configuration when nothing is readable', () => {
		const withoutDriverKey = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			files: { '/etc/odbcinst.ini': '[Odd Entry]\nDescription = No driver key\n' },
		}));
		// An entry with no Driver= has no library to check, so it is not dropped.
		assert.deepStrictEqual(withoutDriverKey.drivers.map(d => d.name), ['Odd Entry']);

		const empty = discoverOdbcConfiguration(createTestHost({ env: { ODBCSYSINI: '/etc' } }));
		assert.deepStrictEqual(
			{ drivers: empty.drivers, dsns: empty.dsns, sources: empty.sources },
			{ drivers: [], dsns: [], sources: [] }
		);
	});
});

suite('discoverOdbcConfiguration (windows)', () => {
	test('reads the registry snapshot and lets user DSNs shadow system DSNs', () => {
		const config = discoverOdbcConfiguration(createTestHost({
			platform: 'win32',
			existingPaths: ['C:\\Windows\\System32\\psqlodbc35w.dll'],
			registry: {
				drivers: {
					'PostgreSQL Unicode(x64)': { Driver: 'C:\\Windows\\System32\\psqlodbc35w.dll', Description: 'PostgreSQL' },
					'ODBC Drivers': { 'PostgreSQL Unicode(x64)': 'Installed' },
				},
				systemDsns: { Shared: { Driver: 'PostgreSQL Unicode(x64)', Server: 'shared.example.com' } },
				userDsns: { Shared: { Driver: 'PostgreSQL Unicode(x64)', Server: 'mine.example.com' } },
			},
		}));

		assert.deepStrictEqual(
			{
				drivers: config.drivers.map(d => d.name),
				dsns: config.dsns.map(d => ({ name: d.name, scope: d.scope, summary: summarizeDsn(d) })),
			},
			{
				// The "ODBC Drivers" index key is bookkeeping, not a driver.
				drivers: ['PostgreSQL Unicode(x64)'],
				dsns: [{ name: 'Shared', scope: 'user', summary: 'mine.example.com' }],
			}
		);
	});
});

suite('parseRegQueryOutput', () => {
	test('extracts direct child keys and their values, ignoring deeper subkeys', () => {
		const output = [
			'',
			'HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers',
			'    SQL Server    REG_SZ    Installed',
			'',
			'HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\SQL Server',
			'    Driver    REG_SZ    C:\\WINDOWS\\system32\\SQLSRV32.dll',
			'    APILevel    REG_SZ    2',
			'',
			'HKEY_LOCAL_MACHINE\\SOFTWARE\\ODBC\\ODBCINST.INI\\SQL Server\\Nested',
			'    Ignored    REG_SZ    yes',
			'',
		].join('\r\n');

		assert.deepStrictEqual(parseRegQueryOutput(output, 'HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI'), {
			'ODBC Drivers': { 'SQL Server': 'Installed' },
			'SQL Server': { Driver: 'C:\\WINDOWS\\system32\\SQLSRV32.dll', APILevel: '2' },
		});
	});
});
