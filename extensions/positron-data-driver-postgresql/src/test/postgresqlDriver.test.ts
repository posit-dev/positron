/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { PostgreSQLClient } from '../postgresqlClient.js';
import { PostgreSQLConnection, PostgreSQLConnectionConfig } from '../postgresqlConnection.js';
import { createSchemaNode } from '../postgresqlNodes.js';

// Default config for tests -- not used to connect, just to construct.
const TEST_CONFIG: PostgreSQLConnectionConfig = {
	kind: 'fields',
	host: 'localhost',
	port: 5432,
	user: 'testuser',
	password: 'testpass',
	database: 'testdb',
	ssl: false
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

// Injects a mock client into a PostgreSQLConnection, bypassing the real pg Client.
function createTestConnection(mockClient: any): PostgreSQLConnection {
	const conn = new PostgreSQLConnection(TEST_CONFIG, noopHost);
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

suite('PostgreSQL Driver Tests', () => {

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
		const conn = new PostgreSQLConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = {
			connect: async () => { throw new Error('Connection refused'); },
		};

		await assert.rejects(
			() => conn.connect(),
			/Failed to connect to PostgreSQL/
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
						{ schema_name: 'app' },
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
		assert.deepStrictEqual(names, ['app', 'public']);

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

		const schemaNode = createSchemaNode(mock, noopHost, undefined, 'public');
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
							udt_name: 'int4',
							is_nullable: 'NO',
							character_maximum_length: null,
							numeric_precision: 32,
							numeric_scale: 0,
						},
						{
							column_name: 'name',
							data_type: 'character varying',
							udt_name: 'varchar',
							is_nullable: 'YES',
							character_maximum_length: 255,
							numeric_precision: null,
							numeric_scale: null,
						},
						{
							column_name: 'price',
							data_type: 'numeric',
							udt_name: 'numeric',
							is_nullable: 'YES',
							character_maximum_length: null,
							numeric_precision: 10,
							numeric_scale: 2,
						},
						{
							column_name: 'active',
							data_type: 'boolean',
							udt_name: 'bool',
							is_nullable: 'NO',
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

		const schemaNode = createSchemaNode(mock, noopHost, undefined, 'public');
		const tables = await tablesOf(schemaNode);
		const productsNode = tables.find(c => c.name === 'products')!;

		const fields = await columnsOf(productsNode);
		assert.strictEqual(fields.length, 4);

		const idField = fields.find(f => f.name === 'id')!;
		assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
		assert.strictEqual(idField.dataType, 'integer');
		// The id column is the primary key; the others are not.
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

	// --- Indexes ---

	test('table Indexes group returns index leaf nodes', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('pg_indexes')) {
				return {
					rows: [
						{ indexname: 'products_pkey' },
						{ indexname: 'products_name_idx' },
					]
				};
			}
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'products' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, undefined, 'public');
		const tables = await tablesOf(schemaNode);
		const productsNode = tables.find(c => c.name === 'products')!;

		const groups = await productsNode.getChildren!();
		const indexesGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupIndexes)!;
		const indexes = await indexesGroup.getChildren!();

		assert.deepStrictEqual(indexes.map(i => i.name).sort(), ['products_name_idx', 'products_pkey']);
		indexes.forEach(i => {
			assert.strictEqual(i.kind, positron.DataConnectionNodeKind.Index);
			assert.strictEqual(i.getChildren, undefined, 'indexes are leaves');
		});
	});

	// --- Data type formatting ---

	test('array types formatted correctly', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'tags',
						data_type: 'ARRAY',
						udt_name: '_text',
						is_nullable: 'YES',
						character_maximum_length: null,
						numeric_precision: null,
						numeric_scale: null,
					}]
				};
			}
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 't' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, noopHost, undefined, 'public');
		const tables = await tablesOf(schema);
		const fields = await columnsOf(tables[0]);
		assert.strictEqual(fields[0].dataType, 'text[]');
	});

	test('user-defined types use udt_name', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'status',
						data_type: 'USER-DEFINED',
						udt_name: 'order_status',
						is_nullable: 'YES',
						character_maximum_length: null,
						numeric_precision: null,
						numeric_scale: null,
					}]
				};
			}
			if (sql.includes('information_schema.tables') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 't' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, noopHost, undefined, 'public');
		const tables = await tablesOf(schema);
		const fields = await columnsOf(tables[0]);
		assert.strictEqual(fields[0].dataType, 'order_status');
	});

	test('numeric without scale omits scale', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'amount',
						data_type: 'numeric',
						udt_name: 'numeric',
						is_nullable: 'YES',
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

		const schema = createSchemaNode(mock, noopHost, undefined, 'public');
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

		const schema = createSchemaNode(mock, noopHost, undefined, 'public');
		const tables = await tablesOf(schema);
		assert.ok(tables[0].preview);
		await tables[0].preview!();
	});
});

suite('PostgreSQL Server Mode Tests', () => {

	// Fields config with no database: the connection targets the whole server, so databases are the
	// top-level nodes.
	const SERVER_CONFIG: PostgreSQLConnectionConfig = {
		kind: 'fields',
		host: 'localhost',
		port: 5432,
		user: 'testuser',
		password: 'testpass',
		ssl: false,
	};

	// Builds a server-mode connection with a base client (used to list databases) and a per-database
	// client (returned for any database node's schema browsing). Stubbing _buildClient bypasses the
	// real pg Client, so getDatabaseClient hands back the mock instead of dialing a server.
	function createServerConnection(baseClient: any, databaseClient: any): PostgreSQLConnection {
		const conn = new PostgreSQLConnection(SERVER_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = baseClient;
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._buildClient = () => databaseClient;
		return conn;
	}

	test('getChildren returns a single Databases group node', async () => {
		const mock = createMockClient();
		const conn = createServerConnection(mock, mock);

		const roots = await conn.getChildren();
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupDatabases);
		assert.strictEqual(roots[0].name, 'Databases');

		await conn.disconnect();
	});

	test('Databases group lists databases, each expanding to its schemas', async () => {
		const baseClient = createMockClient((sql) => {
			if (sql.includes('pg_database')) {
				return { rows: [{ datname: 'analytics' }, { datname: 'app' }] };
			}
			return { rows: [] };
		});
		const databaseClient = createMockClient((sql) => {
			if (sql.includes('information_schema.schemata')) {
				return { rows: [{ schema_name: 'public' }] };
			}
			return { rows: [] };
		});
		const conn = createServerConnection(baseClient, databaseClient);

		const [databasesGroup] = await conn.getChildren();
		const databases = await databasesGroup.getChildren!();
		assert.deepStrictEqual(databases.map(d => d.name), ['analytics', 'app']);
		databases.forEach(d => assert.strictEqual(d.kind, positron.DataConnectionNodeKind.Database));

		// Expanding a database yields a Schemas group backed by the per-database client.
		const [schemasGroup] = await databases[0].getChildren!();
		assert.strictEqual(schemasGroup.kind, positron.DataConnectionNodeKind.GroupSchemas);
		const schemas = await schemasGroup.getChildren!();
		assert.deepStrictEqual(schemas.map(s => s.name), ['public']);

		await conn.disconnect();
	});

	test('server mode falls back from the maintenance database to the default database', async () => {
		const fallbackClient = createMockClient((sql) => {
			if (sql.includes('pg_database')) {
				return { rows: [{ datname: 'app' }] };
			}
			return { rows: [] };
		});
		const conn = new PostgreSQLConnection(SERVER_CONFIG, noopHost);
		// The primary (maintenance-database) client rejects, as it would when 'postgres' is unavailable;
		// the fallback client (the pg default database) connects instead.
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = { connect: async () => { throw new Error('database "postgres" does not exist'); }, end: async () => { } };
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._buildClient = () => fallbackClient;

		await conn.connect();
		assert.strictEqual(await conn.isConnected(), true);

		// Enumeration proceeds against the fallback client.
		const [databasesGroup] = await conn.getChildren();
		const databases = await databasesGroup.getChildren!();
		assert.deepStrictEqual(databases.map(d => d.name), ['app']);

		await conn.disconnect();
	});

	test('connection string with a database is single-database mode', async () => {
		const conn = new PostgreSQLConnection(
			{ kind: 'connectionString', connectionString: 'postgresql://user@localhost:5432/mydb' },
			noopHost
		);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = createMockClient();

		const roots = await conn.getChildren();
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupSchemas);

		await conn.disconnect();
	});

	test('connection string without a database is server mode', async () => {
		const conn = new PostgreSQLConnection(
			{ kind: 'connectionString', connectionString: 'postgresql://user@localhost:5432/' },
			noopHost
		);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = createMockClient();

		const roots = await conn.getChildren();
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupDatabases);

		await conn.disconnect();
	});
});

suite('PostgreSQL Reconnecting Client', () => {

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

	// Builds a PostgreSQLClient whose pg-client factory hands out FakeClients driven by the given
	// per-client handlers (the nth handler backs the nth client built), plus the list of clients
	// created so far.
	function makeClient(handlers: Array<(sql: string, params?: unknown[]) => { rows: unknown[] }>) {
		const clients: FakeClient[] = [];
		const client = new PostgreSQLClient(() => {
			const pg = new FakeClient(handlers[clients.length] ?? (() => ({ rows: [] })));
			clients.push(pg);
			// eslint-disable-next-line local/code-no-any-casts
			return pg as any;
		});
		return { client, clients };
	}

	test('passes queries through the connected client', async () => {
		const { client, clients } = makeClient([() => ({ rows: [{ n: 1 }] })]);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ n: 1 }]);
		assert.strictEqual(clients.length, 1);
		assert.strictEqual(clients[0].connectCount, 1);

		await client.end();
		assert.strictEqual(clients[0].endCount, 1);
	});

	test('reconnects once and retries when the socket is dead', async () => {
		const { client, clients } = makeClient([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ ok: true }]);
		assert.strictEqual(clients.length, 2);
		assert.strictEqual(clients[0].endCount, 1, 'the dead client should be closed');
		assert.strictEqual(clients[1].connectCount, 1, 'the replacement client should be connected');
	});

	test('does not reconnect on a non-connection error', async () => {
		const syntaxError = Object.assign(new Error('syntax error at or near "SELCT"'), { code: '42601' });
		const { client, clients } = makeClient([() => { throw syntaxError; }]);

		await client.connect();
		await assert.rejects(() => client.query('SELCT 1'), /syntax error/);
		assert.strictEqual(clients.length, 1, 'a SQL error should not trigger a reconnect');
	});

	test('coalesces concurrent reconnects into one', async () => {
		const { client, clients } = makeClient([
			() => { throw new Error('Connection terminated unexpectedly'); },
			(sql) => ({ rows: [{ sql }] }),
		]);

		await client.connect();
		const [r1, r2] = await Promise.all([client.query('a'), client.query('b')]);

		assert.strictEqual(clients.length, 2, 'two simultaneous failures should rebuild the client once');
		assert.deepStrictEqual(
			[(r1.rows[0] as { sql: string }).sql, (r2.rows[0] as { sql: string }).sql].sort(),
			['a', 'b']
		);
	});

	// Builds a PostgreSQLClient whose nth connect() throws the nth entry in `connectErrors` (undefined
	// = succeed), so a briefly-unreachable connect sequence can be simulated. Records the attempt
	// count, and passes a no-op sleep so the backoff does not slow the test.
	function connectClient(connectErrors: Array<Error | undefined>) {
		const state = { attempts: 0 };
		const client = new PostgreSQLClient(() => {
			const err = connectErrors[state.attempts];
			state.attempts++;
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: async () => { if (err) { throw err; } },
				query: async () => ({ rows: [] }),
				end: async () => { },
				on: () => { },
			} as any;
		}, async () => { });
		return { client, state };
	}

	test('retries a transient failure during connect', async () => {
		const { client, state } = connectClient([new Error('Connection terminated unexpectedly'), undefined]);

		await client.connect();
		assert.strictEqual(state.attempts, 2, 'the dropped first connect should be retried');
	});

	test('does not retry a terminal error during connect', async () => {
		const authError = Object.assign(new Error('password authentication failed'), { code: '28P01' });
		const { client, state } = connectClient([authError]);

		await assert.rejects(() => client.connect(), /password authentication failed/);
		assert.strictEqual(state.attempts, 1, 'a bad password should fail fast, not retry');
	});
});
