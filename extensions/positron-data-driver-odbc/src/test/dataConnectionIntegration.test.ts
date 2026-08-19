/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Exercises the real registration path: the extension activates, discovers whatever ODBC
// configuration this machine has, and registers its drivers through positron.dataConnections.
//
// What this machine has is not something a test can assume -- a CI runner has no ODBC drivers and
// no data sources, a developer's laptop may have several -- so the assertions here are about the
// shape the driver always presents, not about any particular driver or DSN being present. The
// fixture-driven tests in odbcinst.test.ts cover the discovery logic itself.

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';

const GENERIC_ODBC_DRIVER_ID = 'positron-data-driver-odbc';

suite('Data Connection Integration', () => {
	setup(async () => {
		// Ensure the extension is activated so its drivers are registered.
		await vscode.extensions.getExtension('positron.positron-data-driver-odbc')?.activate();
	});

	test('registers the generic ODBC driver', async () => {
		const drivers = await positron.dataConnections.getDrivers();
		const odbc = drivers.find(driver => driver.id === GENERIC_ODBC_DRIVER_ID);

		assert.ok(odbc, 'the generic ODBC driver should be registered');
		assert.deepStrictEqual(
			{ name: odbc.name, languages: odbc.supportedLanguageIds },
			{ name: 'ODBC', languages: ['python', 'r'] }
		);
	});

	test('always offers the connection-string mechanism, whatever this machine has configured', async () => {
		const drivers = await positron.dataConnections.getDrivers();
		const odbc = drivers.find(driver => driver.id === GENERIC_ODBC_DRIVER_ID)!;

		// The DSN and driver mechanisms depend on the machine; the connection-string mechanism is
		// the one that is always available, and is all a machine with no ODBC configuration gets.
		const connectionString = odbc.mechanisms.find(mechanism => mechanism.id === 'connectionString');
		assert.ok(connectionString, 'the connection-string mechanism should always be offered');
		assert.deepStrictEqual(
			connectionString.parameters.map(parameter => ({ id: parameter.id, required: parameter.required })),
			[{ id: 'connectionString', required: true }]
		);
	});

	test('offers no mechanism with an empty picker', async () => {
		const drivers = await positron.dataConnections.getDrivers();

		// A machine with no data sources must not be shown a "Data Source" dropdown with nothing in
		// it, and likewise for ODBC drivers. Whichever mechanisms this machine ended up with, none
		// of their option parameters may be empty.
		for (const driver of drivers.filter(candidate => candidate.id.startsWith(GENERIC_ODBC_DRIVER_ID))) {
			for (const mechanism of driver.mechanisms) {
				for (const parameter of mechanism.parameters) {
					if (parameter.type === positron.DataConnectionParameterType.Option) {
						assert.ok(
							parameter.options.length > 0,
							`${driver.id}/${mechanism.id}/${parameter.id} offers an empty picker`
						);
					}
				}
			}
		}
	});
});
