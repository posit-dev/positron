/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { SnowflakeConnection, SnowflakeConnectionConfig } from '../snowflakeConnection.js';
import { SnowflakeConnectionFactory, SnowflakeClient, SnowflakeConnectionOptions } from '../snowflakeClient.js';
import { createDatabaseNode, createSchemaNode } from '../snowflakeNodes.js';
import { parseSnowflakeAccount } from '../snowflakeDriver.js';

// Default config for tests -- not used to connect, just to construct.
const TEST_CONFIG: SnowflakeConnectionConfig = {
	account: 'myorg-myacct',
	username: 'testuser',
	password: 'testpass',
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

// Creates a mock SnowflakeClient with configurable query results.
function createMockClient(queryHandler?: (sql: string, binds?: any[]) => { rows: any[] }): any {
	const defaultHandler = () => ({ rows: [] });
	const handler = queryHandler || defaultHandler;
	return {
		connect: async () => { },
		query: async (sql: string, binds?: any[]) => handler(sql, binds),
		end: async () => { },
	};
}

// Injects a mock client into a SnowflakeConnection, bypassing the real sdk client.
function createTestConnection(mockClient: any): SnowflakeConnection {
	const conn = new SnowflakeConnection(TEST_CONFIG, noopHost);
	// eslint-disable-next-line local/code-no-any-casts
	(conn as any)._client = mockClient;
	return conn;
}

// Expands the connection's single Databases group to its database nodes.
async function databasesOf(conn: SnowflakeConnection): Promise<positron.DataConnectionNode[]> {
	const [databasesGroup] = await conn.getChildren();
	return databasesGroup.getChildren!();
}

// Expands a database node to its Schemas group children (schema nodes).
async function schemasOf(databaseNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const [schemasGroup] = await databaseNode.getChildren!();
	return schemasGroup.getChildren!();
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

suite('Snowflake Driver Tests', () => {

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const mock = createMockClient((sql) => {
			if (sql === 'SELECT 1') {
				return { rows: [{ '1': 1 }] };
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
		const conn = new SnowflakeConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = {
			connect: async () => { throw new Error('Incorrect username or password'); },
		};

		await assert.rejects(
			() => conn.connect(),
			/Failed to connect to Snowflake account/
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

	test('getChildren returns a single Databases group node', async () => {
		const mock = createMockClient();
		const conn = createTestConnection(mock);

		const roots = await conn.getChildren();
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupDatabases);
		assert.strictEqual(roots[0].name, 'Databases');

		await conn.disconnect();
	});

	test('Databases group expands to sorted database nodes via SHOW TERSE DATABASES', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW TERSE DATABASES')) {
				return { rows: [{ name: 'SALES' }, { name: 'ANALYTICS' }] };
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const databases = await databasesOf(conn);
		assert.deepStrictEqual(databases.map(d => d.name), ['ANALYTICS', 'SALES']);
		databases.forEach(d => assert.strictEqual(d.kind, positron.DataConnectionNodeKind.Database));

		await conn.disconnect();
	});

	// --- Schema browsing ---

	test('database node expands to schema nodes via INFORMATION_SCHEMA.SCHEMATA', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('INFORMATION_SCHEMA.SCHEMATA')) {
				return { rows: [{ schema_name: 'PUBLIC' }, { schema_name: 'STAGING' }] };
			}
			return { rows: [] };
		});

		const dbNode = createDatabaseNode(mock, noopHost, 'ANALYTICS');
		const schemas = await schemasOf(dbNode);
		assert.deepStrictEqual(schemas.map(s => s.name), ['PUBLIC', 'STAGING']);
		schemas.forEach(s => {
			assert.strictEqual(s.kind, positron.DataConnectionNodeKind.Schema);
			assert.ok(s.getChildren, 'schema node should have getChildren');
		});
	});

	// --- Tables and views within a schema ---

	test('schema getChildren returns Tables and Views groups', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'USERS' }, { table_name: 'ORDERS' }] };
			}
			if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes("'VIEW'")) {
				return { rows: [{ table_name: 'USER_ORDERS' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const groups = await schemaNode.getChildren!();
		assert.strictEqual(groups.length, 2);
		assert.strictEqual(groups[0].kind, positron.DataConnectionNodeKind.GroupTables);
		assert.strictEqual(groups[1].kind, positron.DataConnectionNodeKind.GroupViews);

		// Tables.
		const tables = await tablesOf(schemaNode);
		assert.deepStrictEqual(tables.map(t => t.name).sort(), ['ORDERS', 'USERS']);
		tables.forEach(t => {
			assert.strictEqual(t.kind, positron.DataConnectionNodeKind.Table);
			assert.ok(t.getChildren, `${t.name} should have getChildren`);
			assert.ok(t.preview, `${t.name} should have preview`);
		});

		// Views.
		const views = await viewsOf(schemaNode);
		assert.deepStrictEqual(views.map(v => v.name), ['USER_ORDERS']);
		views.forEach(v => {
			assert.strictEqual(v.kind, positron.DataConnectionNodeKind.View);
			assert.ok(v.preview, `${v.name} should have preview`);
		});
	});

	// --- Field nodes (under each table's Columns group) ---

	test('table Columns group returns field nodes with types', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('INFORMATION_SCHEMA.COLUMNS')) {
				return {
					rows: [
						{ column_name: 'ID', data_type: 'NUMBER', character_maximum_length: null, numeric_precision: 38, numeric_scale: 0 },
						{ column_name: 'NAME', data_type: 'TEXT', character_maximum_length: 255, numeric_precision: null, numeric_scale: null },
						{ column_name: 'PRICE', data_type: 'NUMBER', character_maximum_length: null, numeric_precision: 10, numeric_scale: 2 },
						{ column_name: 'ACTIVE', data_type: 'BOOLEAN', character_maximum_length: null, numeric_precision: null, numeric_scale: null },
					]
				};
			}
			if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'PRODUCTS' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const tables = await tablesOf(schemaNode);
		const productsNode = tables.find(c => c.name === 'PRODUCTS')!;

		const fields = await columnsOf(productsNode);
		assert.strictEqual(fields.length, 4);

		const idField = fields.find(f => f.name === 'ID')!;
		assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
		assert.strictEqual(idField.dataType, 'NUMBER(38)');
		// Snowflake does not expose primary keys through INFORMATION_SCHEMA, so no field is marked one.
		assert.strictEqual(idField.isPrimaryKey, false);

		const nameField = fields.find(f => f.name === 'NAME')!;
		assert.strictEqual(nameField.dataType, 'TEXT(255)');

		const priceField = fields.find(f => f.name === 'PRICE')!;
		assert.strictEqual(priceField.dataType, 'NUMBER(10,2)');

		const activeField = fields.find(f => f.name === 'ACTIVE')!;
		assert.strictEqual(activeField.dataType, 'BOOLEAN');

		// Field nodes are leaves (no children) but can be previewed as a single-column Data Explorer.
		fields.forEach(f => {
			assert.strictEqual(f.getChildren, undefined);
			assert.strictEqual(typeof f.preview, 'function');
		});
	});

	// --- Table structure (only a Columns group) ---

	test('table getChildren returns only a Columns group', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'PRODUCTS' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const tables = await tablesOf(schemaNode);
		const groups = await tables[0].getChildren!();

		assert.strictEqual(groups.length, 1);
		assert.strictEqual(groups[0].kind, positron.DataConnectionNodeKind.GroupColumns);
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
			if (sql.includes('INFORMATION_SCHEMA.TABLES') && sql.includes('BASE TABLE')) {
				return { rows: [{ table_name: 'T' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const tables = await tablesOf(schemaNode);
		assert.ok(tables[0].preview);
		await tables[0].preview!();
	});
});

suite('Snowflake Reconnecting Client', () => {

	const OPTIONS: SnowflakeConnectionOptions = {
		account: 'myorg-myacct',
		username: 'testuser',
		password: 'testpass',
	};

	// A fake sdk connection that records its lifecycle calls and answers queries from a per-instance
	// handler (which may throw to simulate a query- or connection-level failure). Callback-based to
	// match the real snowflake-sdk surface.
	class FakeConnection {
		connectCount = 0;
		destroyCount = 0;
		constructor(private readonly _handler: (sql: string, binds?: unknown[]) => { rows: unknown[] }) { }
		connect(cb: (err: any, conn: any) => void) { this.connectCount++; cb(undefined, this); }
		connectAsync(cb: (err: any, conn: any) => void) { this.connectCount++; cb(undefined, this); }
		execute(opts: { sqlText: string; binds?: unknown[]; complete: (err: any, stmt: any, rows: any) => void }) {
			try {
				const { rows } = this._handler(opts.sqlText, opts.binds);
				opts.complete(undefined, {}, rows);
			} catch (err) {
				opts.complete(err, {}, undefined);
			}
		}
		destroy(cb: (err: any, conn: any) => void) { this.destroyCount++; cb(undefined, this); }
	}

	// Builds a factory that hands out FakeConnections driven by the given per-connection handlers (the
	// nth handler backs the nth connection built), plus the list of connections created so far.
	function makeFactory(handlers: Array<(sql: string, binds?: unknown[]) => { rows: unknown[] }>) {
		const connections: FakeConnection[] = [];
		const factory: SnowflakeConnectionFactory = () => {
			const conn = new FakeConnection(handlers[connections.length] ?? (() => ({ rows: [] })));
			connections.push(conn);
			// eslint-disable-next-line local/code-no-any-casts
			return conn as any;
		};
		return { factory, connections };
	}

	test('passes queries through the connected client', async () => {
		const { factory, connections } = makeFactory([() => ({ rows: [{ n: 1 }] })]);
		const client = new SnowflakeClient(OPTIONS, factory);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ n: 1 }]);
		assert.strictEqual(connections.length, 1);
		assert.strictEqual(connections[0].connectCount, 1);

		await client.end();
		assert.strictEqual(connections[0].destroyCount, 1);
	});

	test('reconnects once and retries when the session is dead', async () => {
		const { factory, connections } = makeFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const client = new SnowflakeClient(OPTIONS, factory);

		await client.connect();
		const result = await client.query('SELECT 1');

		assert.deepStrictEqual(result.rows, [{ ok: true }]);
		assert.strictEqual(connections.length, 2);
		assert.strictEqual(connections[0].destroyCount, 1, 'the dead connection should be destroyed');
		assert.strictEqual(connections[1].connectCount, 1, 'the replacement connection should be connected');
	});

	test('does not reconnect on a non-connection error', async () => {
		const sqlError = Object.assign(new Error('SQL compilation error: invalid identifier'), { code: '000904' });
		const { factory, connections } = makeFactory([() => { throw sqlError; }]);
		const client = new SnowflakeClient(OPTIONS, factory);

		await client.connect();
		await assert.rejects(() => client.query('SELCT 1'), /compilation error/);
		assert.strictEqual(connections.length, 1, 'a SQL error should not trigger a reconnect');
	});

	test('coalesces concurrent reconnects into one', async () => {
		const { factory, connections } = makeFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			(sql) => ({ rows: [{ sql }] }),
		]);
		const client = new SnowflakeClient(OPTIONS, factory);

		await client.connect();
		const [r1, r2] = await Promise.all([client.query('a'), client.query('b')]);

		assert.strictEqual(connections.length, 2, 'two simultaneous failures should rebuild the connection once');
		assert.deepStrictEqual(
			[(r1.rows[0] as { sql: string }).sql, (r2.rows[0] as { sql: string }).sql].sort(),
			['a', 'b']
		);
	});

	// A factory whose nth connect() reports the nth entry in `connectErrors` (undefined = succeed), so
	// a transient connect sequence can be simulated. Records the attempt count.
	function connectFactory(connectErrors: Array<Error | undefined>) {
		const state = { attempts: 0 };
		const factory: SnowflakeConnectionFactory = () => {
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: (cb: (err: any, conn: any) => void) => { const err = connectErrors[state.attempts]; state.attempts++; cb(err, undefined); },
				connectAsync: (cb: (err: any, conn: any) => void) => { const err = connectErrors[state.attempts]; state.attempts++; cb(err, undefined); },
				execute: (opts: any) => opts.complete(undefined, {}, []),
				destroy: (cb: (err: any, conn: any) => void) => cb(undefined, undefined),
			} as any;
		};
		return { factory, state };
	}

	test('retries a transient failure during connect', async () => {
		const { factory, state } = connectFactory([new Error('Connection terminated unexpectedly'), undefined]);
		const client = new SnowflakeClient(OPTIONS, factory, async () => { });

		await client.connect();
		assert.strictEqual(state.attempts, 2, 'the dropped first connect should be retried');
	});

	test('does not retry a terminal error during connect', async () => {
		const authError = Object.assign(new Error('Incorrect username or password was specified'), { code: '390100' });
		const { factory, state } = connectFactory([authError]);
		const client = new SnowflakeClient(OPTIONS, factory, async () => { });

		await assert.rejects(() => client.connect(), /username or password/);
		assert.strictEqual(state.attempts, 1, 'bad credentials should fail fast, not retry');
	});
});

suite('Snowflake Account Parsing', () => {
	test('bare account identifier is unchanged', () => {
		assert.strictEqual(parseSnowflakeAccount('myorg-myacct'), 'myorg-myacct');
	});

	test('full account URL is reduced to the identifier', () => {
		assert.strictEqual(parseSnowflakeAccount('https://myorg-myacct.snowflakecomputing.com'), 'myorg-myacct');
	});

	test('hostname without a scheme is reduced to the identifier', () => {
		assert.strictEqual(parseSnowflakeAccount('myorg-myacct.snowflakecomputing.com'), 'myorg-myacct');
	});

	test('trailing path is stripped', () => {
		assert.strictEqual(parseSnowflakeAccount('https://myorg-myacct.snowflakecomputing.com/'), 'myorg-myacct');
	});

	test('surrounding whitespace is trimmed', () => {
		assert.strictEqual(parseSnowflakeAccount('  myorg-myacct  '), 'myorg-myacct');
	});

	test('legacy region locator is preserved', () => {
		assert.strictEqual(parseSnowflakeAccount('xy12345.us-east-1'), 'xy12345.us-east-1');
	});
});
