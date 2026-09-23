/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describeConnectError } from '../odbcConnection.js';

suite('describeConnectError', () => {
	test('rewrites the driver manager\'s own diagnostics and passes the driver\'s through', () => {
		// Pinned to linux so the unixODBC wording is asserted whichever platform runs the suite. Only
		// /usr/lib/psqlodbcw.so exists.
		const describe = (message: string) => describeConnectError(
			new Error(message), 'linux', filePath => filePath === '/usr/lib/psqlodbcw.so');

		assert.deepStrictEqual(
			{
				// The reported case: `brew upgrade` deleted the versioned Cellar directory that
				// odbc.ini still names.
				missing: describe(
					'[unixODBC][Driver Manager]Can\'t open lib \'/opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so\' : file not found'),
				// On disk but will not load, say for a missing dependency. unixODBC's libltdl still
				// says "file not found", which is exactly what must not be repeated to the user.
				unloadable: describe(
					'[unixODBC][Driver Manager]Can\'t open lib \'/usr/lib/psqlodbcw.so\' : file not found'),
				// A driver manager that does say why has its reason kept.
				unloadableWithReason: describe(
					'Can\'t open lib \'/usr/lib/psqlodbcw.so\' : wrong ELF class: ELFCLASS32'),
				// A bare filename is resolved by the dynamic linker, so whether it exists is unknown.
				bareLibrary: describe(
					'[unixODBC][Driver Manager]Can\'t open lib \'libsqlite3odbc.so\' : file not found'),
				// A mistyped `Driver=` in a connection string: unixODBC tries the name as a library.
				unregisteredName: describe(
					'[unixODBC][Driver Manager]Can\'t open lib \'PostgreSQL Unicod\' : file not found'),
				unknown: describe(
					'[unixODBC][Driver Manager]Data source name not found and no default driver specified'),
				// Anything the database driver reported is more specific than we could be, so it
				// is passed through untouched.
				passthrough: describe(
					'connection to server on socket "/tmp/.s.PGSQL.5432" failed: No such file or directory'),
			},
			{
				missing: 'This data source uses an ODBC driver that is not installed at /opt/homebrew/Cellar/psqlodbc/16.00.0000/lib/psqlodbcw.so. Reinstall the driver, or correct the path in your odbcinst.ini or odbc.ini.',
				unloadable: 'The ODBC driver at /usr/lib/psqlodbcw.so could not be loaded. The driver may be built for a different architecture than this computer, or a library it depends on may be missing.',
				unloadableWithReason: 'The ODBC driver at /usr/lib/psqlodbcw.so could not be loaded (wrong ELF class: ELFCLASS32). The driver may be built for a different architecture than this computer, or a library it depends on may be missing.',
				bareLibrary: 'The ODBC driver at libsqlite3odbc.so could not be loaded. The driver may be built for a different architecture than this computer, or a library it depends on may be missing.',
				unregisteredName: 'No ODBC driver named \'PostgreSQL Unicod\' is registered on this computer. Check the driver name, or register the driver in your odbcinst.ini.',
				unknown: 'No ODBC data source or driver by that name is configured on this computer. Check the name, or define the data source in your odbc.ini.',
				passthrough: 'connection to server on socket "/tmp/.s.PGSQL.5432" failed: No such file or directory',
			}
		);
	});

	test('points a Windows user at the ODBC Data Source Administrator for an unknown data source', () => {
		// Windows has no odbc.ini; its data sources live in the registry, edited through that tool.
		assert.strictEqual(
			describeConnectError(new Error(
				'[Microsoft][ODBC Driver Manager] Data source name not found and no default driver specified'), 'win32'),
			'No ODBC data source or driver by that name is configured on this computer. Check the name, or add the data source in ODBC Data Source Administrator (64-bit).'
		);
	});

	test('keeps the missing-driver-manager case ahead of the new patterns', () => {
		// A driver manager that is not installed reports the same "can't open lib" shape as a
		// missing vendor driver, and telling the user to reinstall their database driver would
		// send them after the wrong thing. The exact wording is platform-dependent, so this
		// asserts which branch won rather than the text.
		const described = describeConnectError(Object.assign(
			new Error('Can\'t open lib \'libodbc.so\' : file not found'),
			{ driverManagerMissing: true }
		));

		assert.deepStrictEqual(
			{
				namesTheDriverManager: /driver manager/i.test(described),
				sendsThemAfterTheVendorDriver: described.includes('Reinstall the driver'),
			},
			{ namesTheDriverManager: true, sendsThemAfterTheVendorDriver: false }
		);
	});
});
