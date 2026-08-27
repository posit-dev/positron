/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { dialectOfDriver, supportsSql } from '../dialects';

suite('dialectOfDriver', () => {

	test('a driver names the dialect its database speaks', () => {
		assert.deepStrictEqual(
			[
				'positron-data-driver-postgresql',
				'positron-data-driver-snowflake',
				'positron-data-driver-duckdb',
			].map(dialectOfDriver),
			['postgres', 'snowflake', 'duckdb'],
		);
	});

	test('the same database reached over ODBC gets the same dialect', () => {
		// ODBC registers one driver per database it recognizes, named after it.
		assert.deepStrictEqual(
			['positron-data-driver-odbc-postgresql', 'positron-data-driver-odbc-sqlserver']
				.map(dialectOfDriver),
			['postgres', 'tsql'],
		);
	});

	test('a driver that could be pointed at anything has no dialect', () => {
		// The generic ODBC driver connects to whatever the user's driver manager offers.
		assert.strictEqual(dialectOfDriver('positron-data-driver-odbc'), '');
	});

	test('an unknown driver has no dialect rather than one the parser would reject', () => {
		// A third-party driver id must not reach the parser as a dialect name: it would be
		// reported to the user as an unrecognized dialect they never chose.
		assert.strictEqual(dialectOfDriver('com.example.my-database'), '');
	});
});

suite('supportsSql', () => {

	test('a database can be written against', () => {
		assert.strictEqual(supportsSql('positron-data-driver-postgresql'), true);
	});

	test('a pins connection cannot: it holds stored objects, not tables', () => {
		assert.strictEqual(supportsSql('positron-data-driver-pins'), false);
	});

	test('an unknown driver is assumed to be a database', () => {
		// Far likelier than not being one, and guessing the other way leaves a user with no
		// completions and nothing said about why.
		assert.strictEqual(supportsSql('com.example.my-database'), true);
	});
});
