/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { DataConnectionsApi, explainEmptySchema, flattenSchemaNodes, readConnectionSchema, SchemaReader, schemaOfProfile, SqlSchema, SqlTable } from '../schema';
import { SchemaIndex } from '../schemaIndex';
import { testLog } from './support';

const Kind = positron.DataConnectionNodeKind;

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
				name: 'orders', kind: Kind.Table, children: [
					{ name: 'id', kind: Kind.Field, dataType: 'INTEGER', isPrimaryKey: true },
					{ name: 'total', kind: Kind.Field, dataType: 'REAL' },
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
				name: 'SHOP', kind: Kind.Catalog, children: [
					{
						name: 'SALES', kind: Kind.Schema, children: [
							{ name: 'ORDERS', kind: Kind.Table, children: [{ name: 'ID', kind: Kind.Field }] },
							{ name: 'ORDER_SUMMARY', kind: Kind.View, children: [] },
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
				name: 'analytics', kind: Kind.Database, children: [
					{ name: 'events', kind: Kind.Table, children: [] },
				],
			},
		]);

		assert.strictEqual(tables.length, 1);
		assert.strictEqual(tables[0].catalog, 'analytics');
	});

	test('kinds that hold files rather than rows are skipped, along with their contents', () => {
		const tables = flattenSchemaNodes([
			{
				name: 'SALES', kind: Kind.Schema, children: [
					{ name: 'orders', kind: Kind.Table, children: [] },
					{
						name: 'raw_files', kind: Kind.Volume, children: [
							// A volume's children are files; a directory inside one is not a table
							// even though a driver could name it like one.
							{ name: 'orders', kind: Kind.Directory, children: [] },
						],
					},
					{ name: 'orders_pkey', kind: Kind.Index, children: [] },
				],
			},
		]);

		assert.deepStrictEqual(tables.map(table => table.name), ['orders']);
	});

	test('non-field children of a table are not columns', () => {
		// A driver may report indexes alongside columns under a table.
		const tables = flattenSchemaNodes([
			{
				name: 'orders', kind: Kind.Table, children: [
					{ name: 'id', kind: Kind.Field, dataType: 'INT' },
					{ name: 'orders_pkey', kind: Kind.Index },
				],
			},
		]);

		assert.deepStrictEqual(tables[0].columns.map(column => column.name), ['id']);
	});

	test('a table with no children reported has no columns', () => {
		// What a truncated walk looks like: the table is in the summary, its columns were cut.
		const tables = flattenSchemaNodes([
			{ name: 'orders', kind: Kind.Table, truncatedChildCount: 40 },
		]);

		assert.deepStrictEqual(tables, [{
			name: 'orders',
			catalog: undefined,
			schema: undefined,
			kind: 'table',
			connection: undefined,
			profileId: undefined,
			columns: [],
			columnsComplete: false,
		}]);
	});

	test('a table says whether the read reached all of its columns', () => {
		const tables = flattenSchemaNodes([
			{ name: 'whole', kind: Kind.Table, children: [{ name: 'id', kind: Kind.Field }] },
			{ name: 'wide', kind: Kind.Table, children: [{ name: 'id', kind: Kind.Field }], truncatedChildCount: 300 },
		]);

		assert.deepStrictEqual(tables.map(table => [table.name, table.columnsComplete]), [['whole', true], ['wide', false]]);
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

	test('no configured connections points at the Connections pane as a different thing', () => {
		assert.ok(explainEmptySchema(0).includes('Connections pane'));
	});

	test('configured but unconnected names the refresh command', () => {
		assert.ok(explainEmptySchema(2).includes('SQL: Refresh Database Schema'));
	});

	test('open connections that are not databases say so, not "none are open"', () => {
		// The user can see them connected in the Connections pane, so "none are open" would read
		// as the extension being broken rather than as the answer.
		assert.ok(explainEmptySchema(1, 1).includes('not SQL databases'));
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
		configured: [
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
			configured: [
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
			configured: [],
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

	test('a disabled Data Connections feature is explained by the setting that turned it off', async () => {
		// The API rejects rather than answering [], so the log says to change a setting rather
		// than that the user has no connections.
		const { messages, api, log } = harness({
			getConnections: () => Promise.reject(new Error(
				'Data connections are unavailable because the "dataConnections.enabled" setting is disabled.')),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.tables, []);
		assert.ok(messages.some(message => message.includes('dataConnections.enabled')), messages.join('\n'));
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
					nodes: [{ name: 'orders', kind: Kind.Table, children: [{ name: 'id', kind: Kind.Field }] }],
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
				nodes: [{ name: 'orders', kind: Kind.Table, children: [] }],
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
					nodes: [{ name: 'orders', kind: Kind.Table, children: [] }],
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

	test('a closed connection is offered to choose from, but not read', async () => {
		// One just added in the Data Connections pane is closed. Choosing it opens it, so the
		// picker offers it; it has no schema until then. A pin is never offered either way.
		const asked: string[] = [];
		const { api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('shop', 'Shop', false),
				connection('pins', 'Team Pins', false, 'positron-data-driver-pins'),
			]),
			getSchema: (profileId: string) => {
				asked.push(profileId);
				return Promise.resolve(undefined);
			},
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(
			{ asked, connections: schema.connections, configured: schema.configured },
			{
				asked: [],
				connections: [],
				configured: [{ profileId: 'shop', name: 'Shop', driverId: 'positron-data-driver-duckdb' }],
			},
		);
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
				nodes: [{ name: 'orders', kind: Kind.Table, children: [] }],
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
					: { profileId, truncated: false, nodes: [{ name: 'orders', kind: Kind.Table, children: [] }] },
			),
		});

		const schema = await readConnectionSchema(log, api);

		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
	});

	test('a connection that does not answer is given up on without holding up the others', async () => {
		// A warehouse still resuming, or a host that never replies. The read that does answer
		// still fills in, and the one that did not is a hole like a failed read.
		const { messages, api, log } = harness({
			getConnections: () => Promise.resolve([
				connection('hung', 'Hung', true),
				connection('good', 'Good', true),
			]),
			getSchema: (profileId: string) => profileId === 'hung'
				? new Promise(() => { })
				: Promise.resolve({ profileId, truncated: false, nodes: [{ name: 'orders', kind: Kind.Table, children: [] }] }),
		});

		const schema = await readConnectionSchema(log, api, 50);

		assert.deepStrictEqual(schema.tables.map(table => table.name), ['orders']);
		assert.deepStrictEqual(schema.connections.map(each => each.profileId), ['hung', 'good']);
		assert.deepStrictEqual(schema.incompleteProfiles, ['hung']);
		assert.ok(messages.some(message => message.includes('Gave up reading the schema of Hung')), messages.join('\n'));
	});

	test('connections are read side by side, not one after another', async () => {
		let reading = 0;
		let most = 0;
		const { api, log } = harness({
			getConnections: () => Promise.resolve([connection('a', 'A', true), connection('b', 'B', true)]),
			getSchema: async (profileId: string) => {
				most = Math.max(most, ++reading);
				await new Promise(resolve => setTimeout(resolve, 10));
				reading--;
				return { profileId, truncated: false, nodes: [] };
			},
		});

		await readConnectionSchema(log, api);

		assert.strictEqual(most, 2);
	});

	test('a read that fails after it was given up on is ignored', async () => {
		let fail: (error: Error) => void = () => { };
		const { api, log } = harness({
			getConnections: () => Promise.resolve([connection('slow', 'Slow', true)]),
			getSchema: () => new Promise((_, reject) => { fail = reject; }),
		});

		const schema = await readConnectionSchema(log, api, 10);
		fail(new Error('too late'));
		// Let the late rejection settle: unhandled, it would fail the run.
		await new Promise(resolve => setTimeout(resolve, 10));

		assert.deepStrictEqual(schema.incompleteProfiles, ['slow']);
	});

	suite('read after read', () => {
		/** A reader over connections the test edits, counting which ones it walks. */
		function reader(timeoutMs?: number, getSchema?: DataConnectionsApi['getSchema']) {
			const state = { connections: [] as positron.DataConnectionSummary[], walked: [] as string[] };
			const { api, log } = harness({
				getConnections: () => Promise.resolve(state.connections.map(each => ({ ...each }))),
				getSchema: getSchema ?? ((profileId: string) => {
					state.walked.push(profileId);
					return Promise.resolve({
						profileId,
						truncated: false,
						nodes: [{ name: `${profileId}_table`, kind: Kind.Table, children: [] }],
					});
				}),
			});
			return { state, reader: new SchemaReader(log, api, timeoutMs) };
		}

		test('Data Connections switched off is said, without asking the API', async () => {
			let asked = false;
			const { api, log } = harness({
				getConnections: () => {
					asked = true;
					return Promise.resolve([]);
				},
			});

			const schema = await new SchemaReader(log, api, undefined, () => false).read();

			assert.deepStrictEqual({ asked, off: schema.dataConnectionsOff }, { asked: false, off: true });
		});

		test('only a connection that just opened is walked; one that stayed open keeps its tables', async () => {
			const { state, reader: schemas } = reader();
			state.connections = [connection('a', 'A', true)];
			await schemas.read();
			state.connections = [connection('a', 'A', true), connection('b', 'B', true)];

			const schema = await schemas.read();

			assert.deepStrictEqual(
				{ walked: state.walked, tables: schema.tables.map(table => table.name) },
				{ walked: ['a', 'b'], tables: ['a_table', 'b_table'] },
			);
		});

		test('a renamed connection is named anew without being walked again', async () => {
			const { state, reader: schemas } = reader();
			state.connections = [connection('a', 'Old', true)];
			await schemas.read();
			state.connections = [connection('a', 'New', true)];

			const schema = await schemas.read();

			assert.deepStrictEqual(
				{ walked: state.walked, connection: schema.tables[0].connection, open: schema.connections[0].name },
				{ walked: ['a'], connection: 'New', open: 'New' },
			);
		});

		test('a connection that closed and opened again is walked again', async () => {
			const { state, reader: schemas } = reader();
			state.connections = [connection('a', 'A', true)];
			await schemas.read();
			state.connections = [connection('a', 'A', false)];
			await schemas.read();
			state.connections = [connection('a', 'A', true)];

			await schemas.read();

			assert.deepStrictEqual(state.walked, ['a', 'a']);
		});

		test('a fresh read walks every open connection', async () => {
			// What "SQL: Refresh Database Schema" asks for: a table can be added without the
			// connection closing.
			const { state, reader: schemas } = reader();
			state.connections = [connection('a', 'A', true)];
			await schemas.read();

			await schemas.read(true);

			assert.deepStrictEqual(state.walked, ['a', 'a']);
		});

		test('a walk given up on is waited on again, not started a second time beside itself', async () => {
			let walks = 0;
			let finish: (schema: positron.DataConnectionSchema) => void = () => { };
			const { state, reader: schemas } = reader(10, profileId => {
				walks++;
				return new Promise(resolve => {
					finish = resolve;
				}).then(() => ({ profileId, truncated: false, nodes: [{ name: 'late', kind: Kind.Table, children: [] }] }));
			});
			state.connections = [connection('slow', 'Slow', true)];
			const first = await schemas.read();
			const second = schemas.read();
			finish({ profileId: 'slow', truncated: false, nodes: [] });

			assert.deepStrictEqual(
				{ first: first.incompleteProfiles, second: (await second).tables.map(table => table.name), walks },
				{ first: ['slow'], second: ['late'], walks: 1 },
			);
		});

		test('a connection that could not be read is walked again on the next read', async () => {
			let fail = true;
			const walked: string[] = [];
			const { state, reader: schemas } = reader(undefined, profileId => {
				walked.push(profileId);
				return fail
					? Promise.reject(new Error('connection reset'))
					: Promise.resolve({ profileId, truncated: false, nodes: [] });
			});
			state.connections = [connection('a', 'A', true)];
			await schemas.read();
			fail = false;

			const schema = await schemas.read();

			assert.deepStrictEqual({ walked, incomplete: schema.incompleteProfiles }, { walked: ['a', 'a'], incomplete: [] });
		});
	});
});
