/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { RedshiftConnection, RedshiftConnectionConfig } from '../redshiftConnection.js';
import { PgClientFactory, RedshiftClient, RedshiftFieldConfig } from '../redshiftClient.js';
import { createDatabaseNode, createSchemaNode } from '../redshiftNodes.js';
import { parseRedshiftEndpoint } from '../redshiftDriver.js';

// Default config for tests -- not used to connect, just to construct.
const TEST_CONFIG: RedshiftConnectionConfig = {
	kind: 'fields',
	host: 'my-cluster.abc123.us-east-1.redshift.amazonaws.com',
	port: 5439,
	database: 'dev',
	user: 'testuser',
	password: 'testpass',
	ssl: true,
};

// A no-op Data Explorer host: these tests exercise schema browsing, not previewing, and a real
// handler would register a vscode command that collides with the activated extension's. One object
// satisfies both the connection's host interface and the node-builder's preview-host interface.
const noopHost = {
	previewObject: async () => { },
	previewColumn: async () => { },
	openTableView: async () => { },
	openColumnView: async () => { },
	closeTableView: () => { },
};

// Creates a mock pg Client with configurable query results.
function createMockClient(queryHandler?: (sql: string, params?: any[]) => { rows: any[] }): any {
	const defaultHandler = () => ({ rows: [] });
	const handler = queryHandler || defaultHandler;
	return {
		connect: async () => { },
		query: async (sql: string, params?: any[]) => handler(sql, params),
		end: async () => { },
	};
}

// Injects a mock client into a RedshiftConnection, bypassing the real pg Client.
function createTestConnection(mockClient: any): RedshiftConnection {
	const conn = new RedshiftConnection(TEST_CONFIG, noopHost);
	// eslint-disable-next-line local/code-no-any-casts
	(conn as any)._client = mockClient;
	return conn;
}

// Expands a schema node to its Tables group children (table nodes).
async function tablesOf(schemaNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const groups = await schemaNode.getChildren!();
	const tablesGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupTables)!;
	return tablesGroup.getChildren!();
}

// Expands a schema node to its Views group children (view nodes).
async function viewsOf(schemaNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const groups = await schemaNode.getChildren!();
	const viewsGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupViews)!;
	return viewsGroup.getChildren!();
}

// Expands a table or view node to its Columns group children (field nodes).
async function columnsOf(relationNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const groups = await relationNode.getChildren!();
	const columnsGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupColumns)!;
	return columnsGroup.getChildren!();
}

suite('Redshift Driver Tests', () => {

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const mock = createMockClient((sql) => {
			if (sql === 'SELECT 1') {
				return { rows: [{ '?column?': 1 }] };
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		assert.strictEqual(await conn.isConnected(), true);
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('disconnect is idempotent', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);

		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect failure throws', async () => {
		const conn = new RedshiftConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = {
			connect: async () => { throw new Error('Connection refused'); },
		};

		await assert.rejects(
			() => conn.connect(),
			/Failed to connect to Redshift/
		);
		// After failed connect, isConnected should return false.
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect on already-disconnected connection throws', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);
		await conn.disconnect();

		await assert.rejects(
			() => conn.connect(),
			/disconnected/
		);
	});

	// --- isReadOnly ---

	test('isReadOnly returns false', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);
		assert.strictEqual(await conn.isReadOnly(), false);
		await conn.disconnect();
	});

	// --- Root structure ---

	test('getChildren returns a single Schemas group node', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);

		const roots = await conn.getChildren();
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupSchemas);
		assert.strictEqual(roots[0].name, 'Schemas');

		await conn.disconnect();
	});

	test('Schemas group with no user schemas returns no children', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.schemata')) {
				return { rows: [] };
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const [schemasGroup] = await conn.getChildren();
		const schemas = await schemasGroup.getChildren!();
		assert.strictEqual(schemas.length, 0);

		await conn.disconnect();
	});

	// --- Schema browsing ---

	test('Schemas group expands to schema nodes', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.schemata')) {
				return {
					rows: [
						{ schema_name: 'public' },
						{ schema_name: 'analytics' },
					]
				};
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const [schemasGroup] = await conn.getChildren();
		const schemas = await schemasGroup.getChildren!();
		assert.strictEqual(schemas.length, 2);

		const names = schemas.map(c => c.name).sort();
		assert.deepStrictEqual(names, ['analytics', 'public']);

		schemas.forEach(c => {
			assert.strictEqual(c.kind, positron.DataConnectionNodeKind.Schema);
			assert.ok(c.getChildren, 'schema node should have getChildren');
		});

		await conn.disconnect();
	});

	// --- Tables and views within a schema ---

	test('schema getChildren returns Tables and Views groups', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return {
					rows: [
						{ table_name: 'users' },
						{ table_name: 'orders' },
					]
				};
			}
			if (sql.includes('information_schema.tables') && sql.includes('VIEW')) {
				return {
					rows: [
						{ table_name: 'user_orders' },
					]
				};
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'public');
		const groups = await schemaNode.getChildren!();
		assert.strictEqual(groups.length, 2);
		assert.strictEqual(groups[0].kind, positron.DataConnectionNodeKind.GroupTables);
		assert.strictEqual(groups[1].kind, positron.DataConnectionNodeKind.GroupViews);

		// Tables.
		const tables = await tablesOf(schemaNode);
		const tableNames = tables.map(t => t.name).sort();
		assert.deepStrictEqual(tableNames, ['orders', 'users']);
		tables.forEach(t => {
			assert.strictEqual(t.kind, positron.DataConnectionNodeKind.Table);
			assert.ok(t.getChildren, `${t.name} should have getChildren`);
			assert.ok(t.preview, `${t.name} should have preview`);
		});

		// Views.
		const views = await viewsOf(schemaNode);
		assert.deepStrictEqual(views.map(v => v.name), ['user_orders']);
		views.forEach(v => {
			assert.strictEqual(v.kind, positron.DataConnectionNodeKind.View);
			assert.ok(v.getChildren, `${v.name} should have getChildren`);
			assert.ok(v.preview, `${v.name} should have preview`);
		});
	});

	// --- Field nodes (under each table's Columns group) ---

	test('table Columns group returns field nodes with types', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [
						{
							column_name: 'id',
							data_type: 'integer',
							character_maximum_length: null,
							numeric_precision: 32,
							numeric_scale: 0,
						},
						{
							column_name: 'name',
							data_type: 'character varying',
							character_maximum_length: 255,
							numeric_precision: null,
							numeric_scale: null,
						},
						{
							column_name: 'price',
							data_type: 'numeric',
							character_maximum_length: null,
							numeric_precision: 10,
							numeric_scale: 2,
						},
						{
							column_name: 'active',
							data_type: 'boolean',
							character_maximum_length: null,
							numeric_precision: null,
							numeric_scale: null,
						},
					]
				};
			}
			if (sql.includes('table_constraints')) {
				return { rows: [{ column_name: 'id' }] };
			}
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'products' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'public');
		const tables = await tablesOf(schemaNode);
		const productsNode = tables.find(c => c.name === 'products')!;

		const fields = await columnsOf(productsNode);
		assert.strictEqual(fields.length, 4);

		const idField = fields.find(f => f.name === 'id')!;
		assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
		assert.strictEqual(idField.dataType, 'integer');
		// The id column is the declared primary key; the others are not.
		assert.strictEqual(idField.isPrimaryKey, true);

		const nameField = fields.find(f => f.name === 'name')!;
		assert.strictEqual(nameField.dataType, 'character varying(255)');
		assert.strictEqual(nameField.isPrimaryKey, false);

		const priceField = fields.find(f => f.name === 'price')!;
		assert.strictEqual(priceField.dataType, 'numeric(10,2)');

		const activeField = fields.find(f => f.name === 'active')!;
		assert.strictEqual(activeField.dataType, 'boolean');

		// Field nodes are leaves (no children) but can be previewed as a single-column Data Explorer.
		fields.forEach(f => {
			assert.strictEqual(f.getChildren, undefined);
			assert.strictEqual(typeof f.preview, 'function');
		});
	});

	// --- No Indexes group (Redshift has no indexes) ---

	test('table getChildren returns only a Columns group (no Indexes)', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'products' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'public');
		const tables = await tablesOf(schemaNode);
		const groups = await tables[0].getChildren!();

		assert.strictEqual(groups.length, 1);
		assert.strictEqual(groups[0].kind, positron.DataConnectionNodeKind.GroupColumns);
	});

	// --- Data type formatting ---

	test('numeric without scale omits scale', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'amount',
						data_type: 'numeric',
						character_maximum_length: null,
						numeric_precision: 18,
						numeric_scale: 0,
					}]
				};
			}
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 't' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, noopHost, 'public');
		const tables = await tablesOf(schema);
		const fields = await columnsOf(tables[0]);
		assert.strictEqual(fields[0].dataType, 'numeric(18)');
	});

	// --- getChildren after disconnect ---

	test('getChildren after disconnect throws', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);
		await conn.disconnect();

		await assert.rejects(
			() => conn.getChildren(),
			/closed/
		);
	});

	// --- Preview ---

	test('preview does not throw', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 't' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, noopHost, 'public');
		const tables = await tablesOf(schema);
		assert.ok(tables[0].preview);
		await tables[0].preview!();
	});
});

suite('Redshift Cross-Database Detection', () => {

	test('connect enables the Databases group when SVV_REDSHIFT_DATABASES is available', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SVV_REDSHIFT_DATABASES')) {
				return { rows: [{ database_name: 'dev' }, { database_name: 'analytics' }] };
			}
			return { rows: [] };
		});
		const conn = new RedshiftConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = mock;
		await conn.connect();

		const roots = await conn.getChildren();
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupDatabases);

		const databases = await roots[0].getChildren!();
		assert.deepStrictEqual(databases.map(d => d.name), ['dev', 'analytics']);
		databases.forEach(d => assert.strictEqual(d.kind, positron.DataConnectionNodeKind.Database));

		await conn.disconnect();
	});

	test('connect falls back to the Schemas group when SVV_REDSHIFT_DATABASES is unavailable', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SVV_REDSHIFT_DATABASES')) {
				throw new Error('relation "svv_redshift_databases" does not exist');
			}
			return { rows: [] };
		});
		const conn = new RedshiftConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = mock;
		await conn.connect();

		const roots = await conn.getChildren();
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupSchemas);

		await conn.disconnect();
	});

	test('database node browses schemas/tables/columns via the SVV_ALL_* views', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SVV_ALL_SCHEMAS')) {
				return { rows: [{ schema_name: 'public' }] };
			}
			if (sql.includes('SVV_ALL_TABLES') && sql.includes("<> 'VIEW'")) {
				return { rows: [{ table_name: 'events' }] };
			}
			if (sql.includes('SVV_ALL_TABLES') && sql.includes("= 'VIEW'")) {
				return { rows: [{ table_name: 'events_daily' }] };
			}
			if (sql.includes('SVV_ALL_COLUMNS')) {
				return { rows: [{ column_name: 'id', data_type: 'integer', character_maximum_length: null, numeric_precision: 32, numeric_scale: 0 }] };
			}
			return { rows: [] };
		});

		const dbNode = createDatabaseNode(mock, noopHost, 'analytics');
		const [schemasGroup] = await dbNode.getChildren!();
		assert.strictEqual(schemasGroup.kind, positron.DataConnectionNodeKind.GroupSchemas);

		const schemas = await schemasGroup.getChildren!();
		assert.deepStrictEqual(schemas.map(s => s.name), ['public']);

		const groups = await schemas[0].getChildren!();
		const tables = await groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupTables)!.getChildren!();
		assert.deepStrictEqual(tables.map(t => t.name), ['events']);

		// Columns come from SVV_ALL_COLUMNS; primary-key detection is skipped cross-database.
		const columnsGroup = (await tables[0].getChildren!())[0];
		const columns = await columnsGroup.getChildren!();
		assert.strictEqual(columns[0].name, 'id');
		assert.strictEqual(columns[0].isPrimaryKey, false);
	});
});

suite('Redshift Reconnecting Client', () => {

	const FIELDS: RedshiftFieldConfig = {
		host: 'my-cluster.abc123.us-east-1.redshift.amazonaws.com',
		port: 5439,
		database: 'dev',
		user: 'testuser',
		password: 'testpass',
		ssl: true,
	};

	// A fake pg Client that records its lifecycle calls and answers queries from a per-instance
	// handler (which may throw to simulate a query- or connection-level failure).
	class FakeClient {
		connectCount = 0;
		endCount = 0;
		constructor(private readonly _handler: (sql: string, params?: unknown[]) => { rows: unknown[] }) { }
		async connect() { this.connectCount++; }
		async query(sql: string, params?: unknown[]) { return this._handler(sql, params); }
		async end() { this.endCount++; }
		on() { return this; }
	}

	// Builds a PgClientFactory that hands out FakeClients driven by the given per-client handlers (the
	// nth handler backs the nth client built), plus the list of clients created so far.
	function makeFactory(handlers: Array<(sql: string, params?: unknown[]) => { rows: unknown[] }>) {
		const clients: FakeClient[] = [];
		const factory: PgClientFactory = () => {
			const client = new FakeClient(handlers[clients.length] ?? (() => ({ rows: [] })));
			clients.push(client);
			// eslint-disable-next-line local/code-no-any-casts
			return client as any;
		};
		return { factory, clients };
	}

	test('passes queries through the connected client', async () => {
		const { factory, clients } = makeFactory([() => ({ rows: [{ n: 1 }] })]);
		const client = new RedshiftClient(FIELDS, factory);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ n: 1 }]);
		assert.strictEqual(clients.length, 1);
		assert.strictEqual(clients[0].connectCount, 1);

		await client.end();
		assert.strictEqual(clients[0].endCount, 1);
	});

	test('reconnects once and retries when the socket is dead', async () => {
		const { factory, clients } = makeFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const client = new RedshiftClient(FIELDS, factory);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ ok: true }]);
		assert.strictEqual(clients.length, 2);
		assert.strictEqual(clients[0].endCount, 1, 'the dead client should be closed');
		assert.strictEqual(clients[1].connectCount, 1, 'the replacement client should be connected');
	});

	test('does not reconnect on a non-connection error', async () => {
		const syntaxError = Object.assign(new Error('syntax error at or near "SELCT"'), { code: '42601' });
		const { factory, clients } = makeFactory([() => { throw syntaxError; }]);
		const client = new RedshiftClient(FIELDS, factory);

		await client.connect();
		await assert.rejects(() => client.query('SELCT 1'), /syntax error/);
		assert.strictEqual(clients.length, 1, 'a SQL error should not trigger a reconnect');
	});

	test('coalesces concurrent reconnects into one', async () => {
		const { factory, clients } = makeFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			(sql) => ({ rows: [{ sql }] }),
		]);
		const client = new RedshiftClient(FIELDS, factory);

		await client.connect();
		const [r1, r2] = await Promise.all([client.query('a'), client.query('b')]);

		assert.strictEqual(clients.length, 2, 'two simultaneous failures should rebuild the client once');
		assert.deepStrictEqual(
			[(r1.rows[0] as { sql: string }).sql, (r2.rows[0] as { sql: string }).sql].sort(),
			['a', 'b']
		);
	});

	// A pg-client factory whose nth connect() throws the nth entry in `connectErrors` (undefined =
	// succeed), so a resuming-workgroup connect sequence can be simulated. Records the attempt count.
	function connectFactory(connectErrors: Array<Error | undefined>) {
		const state = { attempts: 0 };
		const factory: PgClientFactory = () => {
			const err = connectErrors[state.attempts];
			state.attempts++;
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: async () => { if (err) { throw err; } },
				query: async () => ({ rows: [] }),
				end: async () => { },
				on: () => { },
			} as any;
		};
		return { factory, state };
	}

	test('retries a transient failure during connect', async () => {
		const { factory, state } = connectFactory([new Error('Connection terminated unexpectedly'), undefined]);
		const client = new RedshiftClient(FIELDS, factory, async () => { });

		await client.connect();
		assert.strictEqual(state.attempts, 2, 'the dropped first connect should be retried');
	});

	test('does not retry a terminal error during connect', async () => {
		const authError = Object.assign(new Error('password authentication failed'), { code: '28P01' });
		const { factory, state } = connectFactory([authError]);
		const client = new RedshiftClient(FIELDS, factory, async () => { });

		await assert.rejects(() => client.connect(), /password authentication failed/);
		assert.strictEqual(state.attempts, 1, 'a bad password should fail fast, not retry');
	});
});

suite('Redshift Endpoint Parsing', () => {
	const host = 'wg.694830131898.us-east-1.redshift-serverless.amazonaws.com';

	test('bare hostname leaves port and database unset', () => {
		assert.deepStrictEqual(parseRedshiftEndpoint(host), { host, port: undefined, database: undefined });
	});

	test('full endpoint splits host, port, and database', () => {
		assert.deepStrictEqual(parseRedshiftEndpoint(`${host}:5439/dev`), { host, port: 5439, database: 'dev' });
	});

	test('host with port only', () => {
		assert.deepStrictEqual(parseRedshiftEndpoint(`${host}:5439`), { host, port: 5439, database: undefined });
	});

	test('scheme prefix is stripped', () => {
		assert.deepStrictEqual(parseRedshiftEndpoint(`jdbc:redshift://${host}:5439/dev`), { host, port: 5439, database: 'dev' });
	});

	test('surrounding whitespace is trimmed', () => {
		assert.deepStrictEqual(parseRedshiftEndpoint(`  ${host}:5439/dev  `), { host, port: 5439, database: 'dev' });
	});
});
