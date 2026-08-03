/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { buildAdbcSchema } from '../adbcDataExplorerRpcHandler.js';
import { AdbcRow, AdbcTableRef, IAdbcMetadataClient } from '../adbcWorkerClient.js';
import { WorkerCatalogInfo, WorkerColumnSchema } from '../adbcWorkerProtocol.js';
import { ColumnDisplayType } from 'positron-data-explorer-protocol';
import { makeQuoteIdentifier } from '../adbcDialect.js';

/** An Arrow schema as the worker reports it: Int64, Utf8, Timestamp. */
const ARROW_COLUMNS: WorkerColumnSchema[] = [
	{ name: 'id', typeName: 'Int64', typeId: 2 },
	{ name: 'label', typeName: 'Utf8', typeId: 5 },
	{ name: 'seen_at', typeName: 'Timestamp<MICROSECOND>', typeId: 10 },
];

/**
 * A fake metadata client whose GetTableSchema behavior is configurable, so tests can
 * model both a driver that implements it and one that does not.
 */
class FakeSchemaClient implements IAdbcMetadataClient {
	readonly querySchemaSql: string[] = [];

	constructor(
		private readonly tableSchema: () => WorkerColumnSchema[],
		private readonly querySchema: () => WorkerColumnSchema[] = () => ARROW_COLUMNS,
	) { }

	async runQuery(_sql: string): Promise<AdbcRow[]> {
		throw new Error('not used by these tests');
	}

	async getObjects(): Promise<WorkerCatalogInfo[]> {
		throw new Error('not used by these tests');
	}

	async getTableSchema(_ref: AdbcTableRef): Promise<WorkerColumnSchema[]> {
		return this.tableSchema();
	}

	async getQuerySchema(sql: string): Promise<WorkerColumnSchema[]> {
		this.querySchemaSql.push(sql);
		return this.querySchema();
	}
}

const REF: AdbcTableRef = { catalog: 'main', dbSchema: 'sales', tableName: 'orders' };
const ANSI = makeQuoteIdentifier('ansi');

suite('ADBC Schema Tests', () => {
	suite('buildAdbcSchema', () => {
		test('uses GetTableSchema when the driver implements it', async () => {
			const client = new FakeSchemaClient(() => ARROW_COLUMNS);

			const schema = await buildAdbcSchema(client, REF, ANSI);

			assert.deepStrictEqual(
				{ schema, probes: client.querySchemaSql },
				{
					schema: [
						{ column_name: 'id', column_type: 'Int64', type_display: ColumnDisplayType.Integer },
						{ column_name: 'label', column_type: 'Utf8', type_display: ColumnDisplayType.String },
						{ column_name: 'seen_at', column_type: 'Timestamp<MICROSECOND>', type_display: ColumnDisplayType.Datetime },
					],
					// No fallback probe when the direct route works.
					probes: [],
				});
		});

		test('falls back to a query probe when GetTableSchema throws', async () => {
			// The Databricks driver documents GetTableSchema as unsupported and errors on it.
			const client = new FakeSchemaClient(() => { throw new Error('[Databricks] GetTableSchema'); });

			const schema = await buildAdbcSchema(client, REF, ANSI);

			assert.deepStrictEqual(
				{
					names: schema.map(c => c.column_name),
					displays: schema.map(c => c.type_display),
					probes: client.querySchemaSql,
				},
				{
					names: ['id', 'label', 'seen_at'],
					displays: [ColumnDisplayType.Integer, ColumnDisplayType.String, ColumnDisplayType.Datetime],
					probes: ['SELECT * FROM "main"."sales"."orders" WHERE 1 = 0'],
				});
		});

		test('falls back when GetTableSchema returns no columns', async () => {
			// A driver may report the call as succeeding but hand back nothing.
			const client = new FakeSchemaClient(() => []);

			const schema = await buildAdbcSchema(client, REF, ANSI);

			assert.deepStrictEqual(
				{ count: schema.length, probes: client.querySchemaSql.length },
				{ count: 3, probes: 1 });
		});

		test('propagates the error when the fallback probe also fails', async () => {
			const client = new FakeSchemaClient(
				() => { throw new Error('unsupported'); },
				() => { throw new Error('table not found'); });

			await assert.rejects(() => buildAdbcSchema(client, REF, ANSI), /table not found/);
		});
	});
});
