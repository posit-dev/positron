/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
	discoverOdbcConfiguration,
	IOdbcConfigHost,
	isSameConfiguration,
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
	test('drops a data source whose ODBC driver cannot be resolved, and reports why', () => {
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			home: '/home/brian',
			files: {
				'/etc/odbcinst.ini': [
					'[PostgreSQL Unicode]',
					'Driver = /usr/lib/psqlodbcw.so',
					'',
					// Registered, but its library is gone, so buildDrivers already drops it. A DSN
					// naming it has to go for the same reason, and is reported as the missing
					// library rather than as an unknown name.
					'[Stale Driver]',
					'Driver = /opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so',
				].join('\n'),
				'/etc/odbc.ini': [
					// What Homebrew's psqlodbc writes: a Driver pointing straight at a versioned
					// Cellar path, which the next `brew upgrade` deletes.
					'[PostgreSQL Driver]',
					'Driver = /opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so',
					'',
					'[By Stale Name]',
					'Driver = Stale Driver',
					'',
					'[By Unknown Name]',
					'Driver = Never Installed',
					'',
					// Kept: the name resolves case-insensitively, as ODBC compares it.
					'[Pagila]',
					'Driver = postgresql unicode',
					'Servername = localhost',
					'',
					// Kept: no Driver key, so there is nothing to rule out.
					'[Driverless]',
					'Servername = elsewhere',
				].join('\n'),
			},
			existingPaths: ['/usr/lib/psqlodbcw.so'],
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{
				dsns: ['Driverless', 'Pagila'],
				skipped: [
					{ name: 'By Stale Name', reason: 'missing-library', detail: '/opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so' },
					{ name: 'By Unknown Name', reason: 'unregistered-driver', detail: 'Never Installed' },
					{ name: 'PostgreSQL Driver', reason: 'missing-library', detail: '/opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so' },
				],
			}
		);
	});

	test('keeps a data source naming an unknown driver when no driver file was readable', () => {
		// unixODBC bakes its SYSCONFDIR in at compile time, so the odbcinst.ini the driver manager
		// reads can sit somewhere SYSTEM_CONFIG_DIRS never looks. Having found none of them says
		// nothing about whether the driver exists, and hiding the DSN there would take away a data
		// source that works.
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			files: { '/etc/odbc.ini': '[Pagila]\nDriver = PostgreSQL Unicode\nServername = localhost\n' },
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{ dsns: ['Pagila'], skipped: [] }
		);
	});

	test('keeps a data source naming an unknown driver when the driver file registers no drivers', () => {
		// Homebrew's unixODBC and many distro packages create an empty odbcinst.ini, and one can
		// hold only driver-manager settings under [ODBC]. Either way no driver is registered, so an
		// unrecognized name says as little as it does when no driver file exists.
		const discover = (odbcinst: string) => discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			files: {
				'/etc/odbcinst.ini': odbcinst,
				'/etc/odbc.ini': '[Pagila]\nDriver = PostgreSQL Unicode\nServername = localhost\n',
			},
		}));

		assert.deepStrictEqual(
			[discover(''), discover('[ODBC]\nTrace = No\n')].map(config => ({ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns })),
			[{ dsns: ['Pagila'], skipped: [] }, { dsns: ['Pagila'], skipped: [] }]
		);
	});

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

	test('drops a data source whose driver is braced or a bare library filename, since unixODBC loads neither', () => {
		// unixODBC looks a DSN's Driver value up as a driver name exactly as written, unless it is
		// an absolute path. A braced name (connection-string syntax) or a bare library filename
		// matches no section, and connecting fails with IM002, even when the library exists.
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			files: {
				'/etc/odbcinst.ini': '[PostgreSQL Unicode]\nDriver = /usr/lib/psqlodbcw.so\n',
				'/etc/odbc.ini': [
					'[Braced]',
					'Driver = {PostgreSQL Unicode}',
					'',
					'[Bare Library]',
					'Driver = psqlodbcw.so',
					'',
					'[Versioned Soname]',
					'Driver = libodbcpsql.so.2',
					'',
					'[Pagila]',
					'Driver = PostgreSQL Unicode',
				].join('\n'),
			},
			existingPaths: ['/usr/lib/psqlodbcw.so'],
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{
				dsns: ['Pagila'],
				skipped: [
					{ name: 'Bare Library', reason: 'unregistered-driver', detail: 'psqlodbcw.so' },
					{ name: 'Braced', reason: 'unregistered-driver', detail: '{PostgreSQL Unicode}' },
					{ name: 'Versioned Soname', reason: 'unregistered-driver', detail: 'libodbcpsql.so.2' },
				],
			}
		);
	});

	test('keeps a data source whose registered driver is itself a bare library filename', () => {
		// A minimal odbcinst.ini can register a driver by bare filename rather than an absolute
		// path, relying on the driver manager's own search path the same way a DSN's Driver value
		// can. The DSN names the driver by its section name, so this exercises the *other*
		// existence check in findDsnDriverProblem: the one against the resolved section's own
		// Driver value, not the DSN's.
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			files: {
				'/etc/odbcinst.ini': '[PostgreSQL Unicode]\nDriver = libpsqlodbcw.so\n',
				'/etc/odbc.ini': '[Pagila]\nDriver = PostgreSQL Unicode\nServername = localhost\n',
			},
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{ dsns: ['Pagila'], skipped: [] }
		);
	});

	test('prefers a user-registered driver over a stale system one of the same name in different case', () => {
		// Case-insensitive matching (below) means these two sections are "the same" driver, but a
		// Map keyed on the exact section text keeps them as two distinct entries -- the user file's
		// differently-cased re-registration does not overwrite the system one's Map key the way a
		// same-case override would. The lookup has to break the tie itself, in the user's favor, to
		// honor the shadowing every other precedence check in this module already gives it.
		const config = discoverOdbcConfiguration(createTestHost({
			env: { ODBCSYSINI: '/etc' },
			home: '/home/brian',
			files: {
				'/etc/odbcinst.ini': '[PostgreSQL Unicode]\nDriver = /gone/stale.so\n',
				'/home/brian/.odbcinst.ini': '[postgresql unicode]\nDriver = /usr/lib/psqlodbcw.so\n',
				'/etc/odbc.ini': '[Pagila]\nDriver = PostgreSQL Unicode\nServername = localhost\n',
			},
			existingPaths: ['/usr/lib/psqlodbcw.so'],
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{ dsns: ['Pagila'], skipped: [] }
		);
	});
});

suite('isSameConfiguration', () => {
	test('ignores a file that appears empty, and sees any change to what can be connected to', () => {
		// The reported case: unixODBC creates an empty ~/.odbc.ini on the first connection attempt,
		// and re-registering for it broke the connection that had just opened.
		const odbcinst = '[PostgreSQL Unicode]\nDriver = /usr/lib/psqlodbcw.so\n';
		const odbc = '[Pagila]\nDriver = PostgreSQL Unicode\nServername = localhost\n';
		const discover = (files: Record<string, string>, existingPaths = ['/usr/lib/psqlodbcw.so']) =>
			discoverOdbcConfiguration(createTestHost({ env: { ODBCSYSINI: '/etc' }, home: '/home/brian', files, existingPaths }));

		const before = discover({ '/etc/odbcinst.ini': odbcinst, '/etc/odbc.ini': odbc });

		assert.deepStrictEqual(
			{
				emptyUserFileCreated: isSameConfiguration(before, discover({
					'/etc/odbcinst.ini': odbcinst, '/etc/odbc.ini': odbc, '/home/brian/.odbc.ini': '',
				})),
				dataSourceAdded: isSameConfiguration(before, discover({
					'/etc/odbcinst.ini': odbcinst, '/etc/odbc.ini': `${odbc}\n[Other]\nDriver = PostgreSQL Unicode\n`,
				})),
				dataSourceEdited: isSameConfiguration(before, discover({
					'/etc/odbcinst.ini': odbcinst, '/etc/odbc.ini': odbc.replace('localhost', 'db.example.com'),
				})),
				driverLibraryRemoved: isSameConfiguration(before, discover(
					{ '/etc/odbcinst.ini': odbcinst, '/etc/odbc.ini': odbc }, [])),
			},
			{ emptyUserFileCreated: true, dataSourceAdded: false, dataSourceEdited: false, driverLibraryRemoved: false }
		);
	});
});

suite('discoverOdbcConfiguration (windows)', () => {
	test('drops a DSN whose driver library is gone, whether named or pointed at directly', () => {
		// Also the guard on isLibraryPath: these paths are Windows-shaped but the suite runs on
		// whatever the developer or CI lane is, so a bare path.isAbsolute would call them relative
		// on macOS and Linux and keep every one of these DSNs.
		const config = discoverOdbcConfiguration(createTestHost({
			platform: 'win32',
			existingPaths: ['C:\\Windows\\System32\\psqlodbc35w.dll'],
			registry: {
				drivers: {
					'PostgreSQL Unicode(x64)': { Driver: 'C:\\Windows\\System32\\psqlodbc35w.dll' },
					'Removed Driver': { Driver: 'C:\\Program Files\\Gone\\gone.dll' },
				},
				systemDsns: {
					Good: { Driver: 'PostgreSQL Unicode(x64)', Server: 'shared.example.com' },
					Stale: { Driver: 'Removed Driver', Server: 'stale.example.com' },
					Direct: { Driver: 'C:\\Program Files\\Gone\\gone.dll' },
				},
				userDsns: {},
			},
		}));

		assert.deepStrictEqual(
			{ dsns: config.dsns.map(dsn => dsn.name), skipped: config.skippedDsns },
			{
				dsns: ['Good'],
				skipped: [
					{ name: 'Direct', reason: 'missing-library', detail: 'C:\\Program Files\\Gone\\gone.dll' },
					{ name: 'Stale', reason: 'missing-library', detail: 'C:\\Program Files\\Gone\\gone.dll' },
				],
			}
		);
	});

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
