/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { deserialize, serialize } from 'v8';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { materializeRows } from './duckdbRows';

describe('materializeRows', () => {
	let instance: DuckDBInstance;
	let connection: DuckDBConnection;

	beforeAll(async () => {
		instance = await DuckDBInstance.create(':memory:');
		connection = await instance.connect();
	});

	afterAll(() => {
		connection.closeSync();
		instance.closeSync();
	});

	/** Runs a query and materializes its rows as the worker does. */
	async function rows(sql: string) {
		return materializeRows(await connection.runAndReadAll(sql));
	}

	test('delivers DECIMAL values as exact digit strings', async () => {
		expect(await rows(
			`SELECT CAST(9007199254740993.01 AS DECIMAL(38,2)) AS wide, ` +
			`CAST(-1234567890123456789.005 AS DECIMAL(38,3)) AS negative_wide, ` +
			`CAST(-0.05 AS DECIMAL(10,2)) AS negative_fraction, ` +
			`CAST(1.005 AS DECIMAL(10,3)) AS rounding, ` +
			`CAST(1.50 AS DECIMAL(10,2)) AS trailing_zero, ` +
			`CAST(42 AS DECIMAL(18,0)) AS scale_zero, ` +
			`CAST(NULL AS DECIMAL(10,2)) AS missing`
		)).toEqual([{
			wide: '9007199254740993.01',
			negative_wide: '-1234567890123456789.005',
			negative_fraction: '-0.05',
			rounding: '1.005',
			trailing_zero: '1.50',
			scale_zero: '42',
			missing: null,
		}]);
	});

	test('leaves non-DECIMAL columns as getRowObjectsJS delivers them', async () => {
		expect(await rows(
			`SELECT * FROM (VALUES ` +
			`(CAST(9007199254740993.01 AS DECIMAL(38,2)), 1.5::DOUBLE, 2.5::REAL, DATE '2026-01-02', ` +
			`TIMESTAMP '2026-01-02 03:04:05', 9007199254740993::BIGINT, 170141183460469231731687303715884105727::HUGEINT, 'text'), ` +
			`(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)` +
			`) AS t(dec, dbl, flt, dt, ts, big, huge, str)`
		)).toEqual([
			{
				dec: '9007199254740993.01',
				dbl: 1.5,
				flt: 2.5,
				dt: new Date('2026-01-02T00:00:00.000Z'),
				ts: new Date('2026-01-02T03:04:05.000Z'),
				big: 9007199254740993n,
				huge: 170141183460469231731687303715884105727n,
				str: 'text',
			},
			{ dec: null, dbl: null, flt: null, dt: null, ts: null, big: null, huge: null, str: null },
		]);
	});

	test('keeps DECIMAL values nested in a LIST or STRUCT exact', async () => {
		expect(await rows(
			`SELECT [CAST(9007199254740993.01 AS DECIMAL(38,2)), NULL] AS list, ` +
			`{'amount': CAST(-0.05 AS DECIMAL(10,2)), 'ratio': 0.5::DOUBLE} AS struct`
		)).toEqual([{
			list: ['9007199254740993.01', null],
			struct: { amount: '-0.05', ratio: 0.5 },
		}]);
	});

	test('rows survive the V8 serialization used for IPC unchanged', async () => {
		const materialized = await rows(
			`SELECT CAST(9007199254740993.01 AS DECIMAL(38,2)) AS dec, 1.5::DOUBLE AS dbl, ` +
			`DATE '2026-01-02' AS dt, 9007199254740993::BIGINT AS big`
		);
		expect(deserialize(serialize(materialized))).toEqual(materialized);
	});
});
