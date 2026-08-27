/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DataConnectionsApi, explainEmptySchema, flattenSchemaNodes, readConnectionSchema, schemaOfProfile, SqlSchema, SqlTable } from '../schema';
import { SchemaIndex } from '../schemaIndex';
import { testLog } from './support';

/**
 * Shapes taken from the three namespace layouts the built-in data connection drivers report:
 * tables at the root (SQLite), tables under a schema (PostgreSQL), and tables under a catalog and
 * a schema (Snowflake, Unity Catalog).
 */
suite('flattenSchemaNodes', () => {
	const byName = (tables: SqlTable[], name: string) => tables.find(table => table.name === name);

	test('tables at the root have no namespace', () => {
		const tables = flattenSchemaNodes([
			{
				name: 'orders', kind: 'table', children: [
					{ name: 'id', kind: 'field', dataType: 'INTEGER', isPrimaryKey: true },
					{ name: 'total', kind: 'field', dataType: 'REAL' },
				],
			},
		]);

		assert.strictEqual(tables.length, 1);
		assert.strictEqual(tables[0].name, 'orders');
		assert.strictEqual(tables[0].catalog, undefined);
		assert.strictEqual(tables[0].schema, undefined);
		assert.deepStrictEqual(tables[0].columns, [
			{ name: 'id', dataType: 'INTEGER', isPrimaryKey: true },
			{ name: 'total', dataType: 'REAL', isPrimaryKey: undefined },
		]);
	});

	test('a table takes the schema and catalog it was found under', () => {
		const tables = flattenSchemaNodes([
			{
				name: 'SHOP', kind: 'catalog', children: [
					{
						name: 'SALES', kind: 'schema', children: [
							{ name: 'ORDERS', kind: 'table', children: [{ name: 'ID', kind: 'field' }] },
							{ name: 'ORDER_SUMMARY', kind: 'view', children: [] },
						],
					},
				],
			},
		], 'Snowflake');

		assert.deepStrictEqual(tables.map(table => table.name), ['ORDERS', 'ORDER_SUMMARY']);
		for (const table of tables) {
			assert.strictEqual(table.catalog, 'SHOP');
			assert.strictEqual(table.schema, 'SALES');
			assert.strictEqual(table.connection, 'Snowflake');
		}
		assert.strictEqual(byName(tables, 'ORDERS')!.kind, 'table');
		assert.strictEqual(byName(tables, 'ORDER_SUMMARY')!.kind, 'view');
	});

	test('databases qualify a table the same way catalogs do', () => {
		const tables = flattenSchemaNodes([
			{
				name: 'analytics', kind: 'database', children: [
					{ name: 'events', kind: 'table', children: [] },
				],
			},
		]);

		assert.strictEqual(tables.length, 1);
		assert.strictEqual(tables[0].catalog, 'analytics');
	});

	test('kinds that hold files rather than rows are skipped, along with their contents', () => {
		const tables = flattenSchemaNodes([
			{
				name: 'SALES', kind: 'schema', children: [
					{ name: 'orders', kind: 'table', children: [] },
					{
						name: 'raw_files', kind: 'volume', children: [
							// A volume's children are files; a directory inside one is not a table
							// even though a driver could name it like one.
							{ name: 'orders', kind: 'directory', children: [] },
						],
					},
					{ name: 'orders_pkey', kind: 'index', children: [] },
				],
			},
		]);

		assert.deepStrictEqual(tables.map(table => table.name), ['orders']);
	});

	test('non-field children of a table are not columns', () => {
		// A driver may report indexes alongside columns under a table.
		const tables = flattenSchemaNodes([
			{
				name: 'orders', kind: 'table', children: [
					{ name: 'id', kind: 'field', dataType: 'INT' },
					{ name: 'orders_pkey', kind: 'index' },
				],
			},
		]);

		assert.deepStrictEqual(tables[0].columns.map(column => column.name), ['id']);
	});

	test('a table with no children reported has no columns', () => {
		// What a truncated walk looks like: the table is in the summary, its columns were cut.
		const tables = flattenSchemaNodes([
			{ name: 'orders', kind: 'table', truncatedChildCount: 40 },
		]);

		assert.deepStrictEqual(tables, [{
			name: 'orders',
			catalog: undefined,
			schema: undefined,
			kind: 'table',
			connection: undefined,
			profileId: undefined,
			columns: [],
		}]);
	});

	test('an empty tree yields no tables', () => {
		assert.deepStrictEqual(flattenSchemaNodes([]), []);
	});
});

/**
 * The empty-schema paths, which is what a user without a live connection actually gets. They all
 * look the same from the outside -- keyword completions only -- so what distinguishes them is the
 * explanation logged, and that is what these assert.
 */
suite('explainEmptySchema', () => {

	test('a disabled Data Connections feature names the setting', () => {
		// getConnections cannot say so on its own: it returns [] whether the feature is off or the
		// user has nothing configured, and the two call for different things from the user.
		assert.ok(explainEmptySchema(false, 0).includes('dataConnections.enabled'));
	});

	test('no configured connections points at the Connections pane as a different thing', () => {
		assert.ok(explainEmptySchema(true, 0).includes('Connections pane'));
	});

	test('configured but unconnected names the refresh command', () => {
		assert.ok(explainEmptySchema(true, 2).includes('SQL: Refresh Database Schema'));
	});

	test('open connections that are not databases say so, not "none are open"', () => {
		// The user can see them connected in the Connections pane, so "none are open" would read
		// as the extension being broken rather than as the answer.
		assert.ok(explainEmptySchema(true, 1, 1).includes('not SQL databases'));
	});
});

/**
 * Scoping a schema to one connection, which is what a SQL file written against a single database
 * completes and is checked against.
 */
suite('schemaOfProfile', () => {

	const schema: SqlSchema = {
		tables: [
			{ name: 'orders', kind: 'table', profileId: 'warehouse', connection: 'Warehouse', columns: [] },
			{ name: 'staging', kind: 'table', profileId: 'local', connection: 'Local', columns: [] },
		],
		connections: [
			{ profileId: 'warehouse', name: 'Warehouse', driverId: 'positron-data-driver-snowflake' },
			{ profileId: 'local', name: 'Local', driverId: 'positron-data-driver-duckdb' },
		],
		incompleteProfiles: ['local'],
	};

	test('only that connection\'s tables and name survive', () => {
		assert.deepStrictEqual(schemaOfProfile(schema, 'warehouse'), {
			tables: [schema.tables[0]],
			connections: [
				{ profileId: 'warehouse', name: 'Warehouse', driverId: 'positron-data-driver-snowflake' },
			],
			incompleteProfiles: [],
		});
	});

	test('another connection\'s hole is not a hole in this one', () => {
		// Otherwise a file scoped to a fully read connection would stop reporting unknown names
		// because some unrelated warehouse was too large to read.
		assert.strictEqual(new SchemaIndex(schemaOfProfile(schema, 'warehouse')).isComplete, true);
	});

	test('a connection that is not open leaves the file with nothing', () => {
		assert.deepStrictEqual(schemaOfProfile(schema, 'gone'), {
			tables: [],
			connections: [],
			incompleteProfiles: [],
		});
	});
});

suite('readConnectionSchema', () => {

	/** Collects what was logged, and stands in for the data connections API. */
	function harness(api: Partial<DataConnectionsApi>) {
		const { log, messages } = testLog();

		return {
			messages,
			log,
			api: {
				getConnections: () => Promise.resolve([]),
				getSchema: () => Promise.resolve(undefined),
				...api,
			} as DataConnectionsApi,
		};
	}

	/** A connection summary, as positron.dataConnections.getConnections reports one. */
	function connection(
		profileId: string,
		name: string,
		connected: boolean,
		driverId = 'positron-data-driver-duckdb',
	) {
		return { profileId, name, driverId, driverName: 'DuckDB', connected };
	}

	test('an unavailable API is not an error', async () => {
		// A Positron without Data Connections. The SQL file still gets keywords and diagnostics.
		const { messages, api, log } = harness({
			getConnections: () => Promise.reject(new Error('no such API')),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.tables, []);
		assert.ok(messages.length > 0, 'Expected the absence to be explained');
	});

	test('only live connections are asked for their schema', async () => {
		const asked: string[] = [];
		const { api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('live', 'Live', true),
				connection('cold', 'Cold', false),
			]),
			getSchema: (profileId: string) => {
				asked.push(profileId);
				return Promise.resolve({
					profileId,
					truncated: false,
					nodes: [{ name: 'orders', kind: 'table', children: [{ name: 'id', kind: 'field' }] }],
				});
			},
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(asked, ['live'], 'the cold connection has no schema to read');
		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
		assert.strictEqual(schema.tables[0].connection, 'Live');
		// The profile is carried so a document link knows which tree to reveal the table in.
		assert.strictEqual(schema.tables[0].profileId, 'live');
		assert.deepStrictEqual(schema.incompleteProfiles, []);
	});

	test('a read cut short marks that connection incomplete, so names are not judged by it', async () => {
		const { api, log } = harness({
			getConnections: () => Promise.resolve([connection('a', 'Warehouse', true)]),
			getSchema: (profileId: string) => Promise.resolve({
				profileId,
				truncated: true,
				nodes: [{ name: 'orders', kind: 'table', children: [] }],
			}),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.incompleteProfiles, ['a']);
		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
	});

	test('a connection that could not be read marks the schema incomplete', async () => {
		const { messages, api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('broken', 'Broken', true),
				connection('good', 'Good', true),
			]),
			getSchema: (profileId: string) => profileId === 'broken'
				? Promise.reject(new Error('connection reset'))
				: Promise.resolve({
					profileId,
					truncated: false,
					nodes: [{ name: 'orders', kind: 'table', children: [] }],
				}),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
		assert.ok(messages.some(message => message.includes('Broken')));
		// A connection that could not be read is a hole in the schema, same as a read cut short:
		// a name that lives in the hole must not be reported as unknown. Only that connection's,
		// though -- the one that did read is a full picture of itself.
		assert.deepStrictEqual(schema.incompleteProfiles, ['broken']);
	});

	test('a connection that is not a SQL database is not read or offered', async () => {
		// A Posit Connect pin holds a stored R or Python object. There is nothing to select from,
		// so it must not be asked for a schema and must not appear as something to write against.
		const asked: string[] = [];
		const { messages, api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('pins', 'Team Pins', true, 'positron-data-driver-pins'),
			]),
			getSchema: (profileId: string) => {
				asked.push(profileId);
				return Promise.resolve({ profileId, truncated: false, nodes: [] });
			},
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(
			{ asked, connections: schema.connections, tables: schema.tables },
			{ asked: [], connections: [], tables: [] },
		);
		assert.ok(
			messages.some(message => message.includes('not SQL databases')),
			`Expected the skip to be explained, got ${JSON.stringify(messages)}`,
		);
	});

	test('a connection carries the driver it was made with, which decides the dialect', async () => {
		const { api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('warehouse', 'Warehouse', true, 'positron-data-driver-snowflake'),
			]),
			getSchema: (profileId: string) => Promise.resolve({
				profileId,
				truncated: false,
				nodes: [{ name: 'orders', kind: 'table', children: [] }],
			}),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.connections, [{
			profileId: 'warehouse',
			name: 'Warehouse',
			driverId: 'positron-data-driver-snowflake',
		}]);
	});

	test('a connection that closed between the two calls is skipped, not fatal', async () => {
		// The user can disconnect at any moment, including between getConnections and getSchema.
		const { api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('gone', 'Gone', true),
				connection('good', 'Good', true),
			]),
			getSchema: (profileId: string) => Promise.resolve(
				profileId === 'gone'
					? undefined
					: { profileId, truncated: false, nodes: [{ name: 'orders', kind: 'table', children: [] }] },
			),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
	});
});
