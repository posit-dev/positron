/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { createRootNodes, fetchTables, formatDataType, OdbcTableRef } from '../odbcNodes.js';
import { buildOdbcSchema } from '../odbcDataExplorerRpcHandler.js';
import { IOdbcQueryClient } from '../odbcWorkerClient.js';
import { OdbcRow } from '../odbcWorkerProtocol.js';

/** A fake query client backed by fixed SQLTables / SQLColumns rows. */
function createFakeClient(options: {
	tables?: OdbcRow[];
	columns?: OdbcRow[];
	primaryKeys?: OdbcRow[] | 'unsupported';
}): IOdbcQueryClient {
	return {
		runQuery: async () => [],
		tables: async () => options.tables ?? [],
		columns: async () => options.columns ?? [],
		primaryKeys: async () => {
			if (options.primaryKeys === 'unsupported') {
				throw new Error('SQLPrimaryKeys is not supported by this driver');
			}
			return options.primaryKeys ?? [];
		},
	};
}

/** Walks a node tree into a compact `name (kind)` outline, so one assertion covers the shape. */
async function outline(nodes: readonly positron.DataConnectionNode[], depth = 0): Promise<string[]> {
	const lines: string[] = [];
	for (const node of nodes) {
		lines.push(`${'  '.repeat(depth)}${node.name} (${node.kind})${node.dataType ? `: ${node.dataType}` : ''}${node.isPrimaryKey ? ' [pk]' : ''}`);
		if (node.getChildren) {
			lines.push(...await outline(await node.getChildren(), depth + 1));
		}
	}
	return lines;
}

const noopPreviewHost = {
	previewObject: async () => 'noop-dataset',
	previewColumn: async () => 'noop-dataset',
};

function tableRow(cat: string | null, schema: string | null, name: string, type = 'TABLE'): OdbcRow {
	return { TABLE_CAT: cat, TABLE_SCHEM: schema, TABLE_NAME: name, TABLE_TYPE: type };
}

suite('fetchTables', () => {
	test('normalizes catalog and schema, classifies views, and drops nameless rows', async () => {
		const client = createFakeClient({
			tables: [
				tableRow('pagila', 'public', 'actor'),
				tableRow(null, '', 'orphan'),
				tableRow('pagila', 'public', 'actor_info', 'VIEW'),
				tableRow('pagila', 'public', '', 'TABLE'),
			],
		});

		assert.deepStrictEqual(await fetchTables(client), [
			{ catalog: 'pagila', schema: 'public', name: 'actor', kind: 'table' },
			// An empty catalog/schema means "this backend does not use that level", so both
			// normalize to undefined rather than to an empty string.
			{ catalog: undefined, schema: undefined, name: 'orphan', kind: 'table' },
			{ catalog: 'pagila', schema: 'public', name: 'actor_info', kind: 'view' },
		]);
	});
});

suite('createRootNodes', () => {
	test('collapses the catalog and schema levels a backend does not use', async () => {
		const tables: OdbcTableRef[] = [
			{ name: 'orders', kind: 'table' },
			{ name: 'customers', kind: 'table' },
		];
		const client = createFakeClient({ columns: [] });

		assert.deepStrictEqual(
			await outline(createRootNodes(tables, client, noopPreviewHost)),
			[
				// No catalogs, no schemas, and no views: straight to Tables.
				'Tables (group-tables)',
				'  orders (table)',
				'    Columns (group-columns)',
				'  customers (table)',
				'    Columns (group-columns)',
			]
		);
	});

	test('shows a schema level when the backend has one, and omits the empty Views group', async () => {
		const tables: OdbcTableRef[] = [
			{ schema: 'public', name: 'actor', kind: 'table' },
			{ schema: 'staging', name: 'raw_actor', kind: 'table' },
		];
		const client = createFakeClient({ columns: [] });

		assert.deepStrictEqual(
			await outline(createRootNodes(tables, client, noopPreviewHost)),
			[
				'Schemas (group-schemas)',
				'  public (schema)',
				'    Tables (group-tables)',
				'      actor (table)',
				'        Columns (group-columns)',
				'  staging (schema)',
				'    Tables (group-tables)',
				'      raw_actor (table)',
				'        Columns (group-columns)',
			]
		);
	});

	test('shows a catalog level when tables span more than one catalog', async () => {
		const tables: OdbcTableRef[] = [
			{ catalog: 'sales', schema: 'dbo', name: 'orders', kind: 'table' },
			{ catalog: 'hr', schema: 'dbo', name: 'staff', kind: 'view' },
		];
		const client = createFakeClient({ columns: [] });

		assert.deepStrictEqual(
			await outline(createRootNodes(tables, client, noopPreviewHost)),
			[
				'Catalogs (group-catalogs)',
				'  hr (catalog)',
				'    Schemas (group-schemas)',
				'      dbo (schema)',
				// Only a view under hr, so no Tables group is offered.
				'        Views (group-views)',
				'          staff (view)',
				'            Columns (group-columns)',
				'  sales (catalog)',
				'    Schemas (group-schemas)',
				'      dbo (schema)',
				'        Tables (group-tables)',
				'          orders (table)',
				'            Columns (group-columns)',
			]
		);
	});

	test('marks primary key columns on tables and tolerates a driver without SQLPrimaryKeys', async () => {
		const columns = [
			{ COLUMN_NAME: 'actor_id', TYPE_NAME: 'int4', COLUMN_SIZE: 10, ORDINAL_POSITION: 1, DATA_TYPE: 4 },
			{ COLUMN_NAME: 'first_name', TYPE_NAME: 'varchar', COLUMN_SIZE: 45, ORDINAL_POSITION: 2, DATA_TYPE: 12 },
		];

		const withKeys = createFakeClient({ columns, primaryKeys: [{ COLUMN_NAME: 'actor_id' }] });
		const withoutKeys = createFakeClient({ columns, primaryKeys: 'unsupported' });
		const table: OdbcTableRef[] = [{ schema: 'public', name: 'actor', kind: 'table' }];
		const view: OdbcTableRef[] = [{ schema: 'public', name: 'actor', kind: 'view' }];

		assert.deepStrictEqual(
			{
				table: await outline(createRootNodes(table, withKeys, noopPreviewHost)),
				// A driver that errors on SQLPrimaryKeys degrades to "no primary key" rather than
				// failing the whole Columns expansion.
				driverWithoutPrimaryKeys: await outline(createRootNodes(table, withoutKeys, noopPreviewHost)),
				// Views have no primary key, so they are never asked for one.
				view: await outline(createRootNodes(view, withKeys, noopPreviewHost)),
			},
			{
				table: [
					'Schemas (group-schemas)', '  public (schema)', '    Tables (group-tables)', '      actor (table)',
					'        Columns (group-columns)',
					'          actor_id (field): int4 [pk]',
					'          first_name (field): varchar(45)',
				],
				driverWithoutPrimaryKeys: [
					'Schemas (group-schemas)', '  public (schema)', '    Tables (group-tables)', '      actor (table)',
					'        Columns (group-columns)',
					'          actor_id (field): int4',
					'          first_name (field): varchar(45)',
				],
				view: [
					'Schemas (group-schemas)', '  public (schema)', '    Views (group-views)', '      actor (view)',
					'        Columns (group-columns)',
					'          actor_id (field): int4',
					'          first_name (field): varchar(45)',
				],
			}
		);
	});
});

suite('formatDataType', () => {
	test('appends size only where the user chose it, and leaves parameterized names alone', () => {
		assert.deepStrictEqual(
			[
				{ TYPE_NAME: 'varchar', COLUMN_SIZE: 255 },
				{ TYPE_NAME: 'int4', COLUMN_SIZE: 10 },
				{ TYPE_NAME: 'numeric', COLUMN_SIZE: 12, DECIMAL_DIGITS: 4 },
				{ TYPE_NAME: 'varchar(50)', COLUMN_SIZE: 50 },
				{ TYPE_NAME: '' },
			].map(formatDataType),
			// int4's "size" is an artifact of the ODBC type mapping, not something anyone set.
			['varchar(255)', 'int4', 'numeric(12,4)', 'varchar(50)', '']
		);
	});
});

suite('buildOdbcSchema', () => {
	test('orders columns by ordinal position and maps ODBC type codes to display types', async () => {
		const client = createFakeClient({
			columns: [
				{ COLUMN_NAME: 'last_update', TYPE_NAME: 'timestamptz', DATA_TYPE: 93, ORDINAL_POSITION: 3 },
				{ COLUMN_NAME: 'actor_id', TYPE_NAME: 'int4', DATA_TYPE: 4, ORDINAL_POSITION: 1 },
				{ COLUMN_NAME: 'first_name', TYPE_NAME: 'varchar', DATA_TYPE: 12, ORDINAL_POSITION: 2 },
				{ COLUMN_NAME: 'weird', TYPE_NAME: 'GEOGRAPHY', DATA_TYPE: 5432, ORDINAL_POSITION: 4 },
				{ COLUMN_NAME: 'picture', TYPE_NAME: 'bytea', DATA_TYPE: -3, ORDINAL_POSITION: 5 },
			],
		});

		assert.deepStrictEqual(
			await buildOdbcSchema(client, { schema: 'public', name: 'actor', kind: 'table' }),
			[
				{ column_name: 'actor_id', column_type: 'int4', type_display: 'integer', is_binary: false },
				{ column_name: 'first_name', column_type: 'varchar', type_display: 'string', is_binary: false },
				{ column_name: 'last_update', column_type: 'timestamptz', type_display: 'datetime', is_binary: false },
				// An unrecognized type code falls back to the type name, which here says nothing
				// useful either, so the column is opaque -- but opaque is not binary, and only a
				// binary column may skip having its value fetched.
				{ column_name: 'weird', column_type: 'GEOGRAPHY', type_display: 'object', is_binary: false },
				// SQL_VARBINARY: the flag that keeps its bytes from ever being fetched.
				{ column_name: 'picture', column_type: 'bytea', type_display: 'object', is_binary: true },
			]
		);
	});
});
