/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { SnowflakeConnection, SnowflakeConnectionConfig } from '../snowflakeConnection.js';
import { defaultConnectionFactory, SnowflakeConnectionFactory, SnowflakeClient, SnowflakeConnectionOptions } from '../snowflakeClient.js';
import { createDatabaseNode, createSchemaNode, parseSemanticViewDescription } from '../snowflakeNodes.js';
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
	previewObject: async () => 'noop-dataset',
	previewColumn: async () => 'noop-dataset',
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

// Expands a schema node to its Stages group children (stage nodes).
async function stagesOf(schemaNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const groups = await schemaNode.getChildren!();
	const stagesGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupStages)!;
	return stagesGroup.getChildren!();
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

	test('database node expands to schema nodes via SHOW TERSE SCHEMAS', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW TERSE SCHEMAS')) {
				return { rows: [{ name: 'PUBLIC' }, { name: 'STAGING' }] };
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
			if (sql.includes('SHOW TERSE TABLES')) {
				return { rows: [{ name: 'USERS' }, { name: 'ORDERS' }] };
			}
			if (sql.includes('SHOW TERSE VIEWS')) {
				return { rows: [{ name: 'USER_ORDERS' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const groups = await schemaNode.getChildren!();
		assert.strictEqual(groups.length, 4);
		assert.strictEqual(groups[0].kind, positron.DataConnectionNodeKind.GroupTables);
		assert.strictEqual(groups[1].kind, positron.DataConnectionNodeKind.GroupViews);
		assert.strictEqual(groups[2].kind, positron.DataConnectionNodeKind.GroupSemanticViews);
		assert.strictEqual(groups[3].kind, positron.DataConnectionNodeKind.GroupStages);

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

	// --- Stages within a schema ---

	test('Stages group lists stage nodes as leaves via SHOW STAGES', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'RAW_LOAD' }, { name: 'EXPORTS' }] };
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const stages = await stagesOf(schemaNode);
		// Names are sorted client-side, so EXPORTS precedes RAW_LOAD.
		assert.deepStrictEqual(stages.map(s => s.name), ['EXPORTS', 'RAW_LOAD']);
		stages.forEach(s => {
			assert.strictEqual(s.kind, positron.DataConnectionNodeKind.Stage);
			// Stages hold files, not rows: leaf nodes with no children and no preview.
			assert.strictEqual(s.getChildren, undefined);
			assert.strictEqual(s.preview, undefined);
		});
	});

	// --- Field nodes (under each table's Columns group) ---

	test('table Columns group returns field nodes with types', async () => {
		const mock = createMockClient((sql) => {
			// DESCRIBE returns a ready-formatted `type` string per column, in ordinal order.
			if (sql.includes('DESCRIBE TABLE')) {
				return {
					rows: [
						{ name: 'ID', type: 'NUMBER(38,0)' },
						{ name: 'NAME', type: 'VARCHAR(255)' },
						{ name: 'PRICE', type: 'NUMBER(10,2)' },
						{ name: 'ACTIVE', type: 'BOOLEAN' },
					]
				};
			}
			if (sql.includes('SHOW TERSE TABLES')) {
				return { rows: [{ name: 'PRODUCTS' }] };
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
		assert.strictEqual(idField.dataType, 'NUMBER(38,0)');
		// Snowflake does not expose primary keys for browsing, so no field is marked one.
		assert.strictEqual(idField.isPrimaryKey, false);

		const nameField = fields.find(f => f.name === 'NAME')!;
		assert.strictEqual(nameField.dataType, 'VARCHAR(255)');

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
			if (sql.includes('SHOW TERSE TABLES')) {
				return { rows: [{ name: 'PRODUCTS' }] };
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

	test('table node preview opens the table in the Data Explorer with its full identity', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW TERSE TABLES')) {
				return { rows: [{ name: 'T' }] };
			}
			return { rows: [] };
		});

		// Record the host call the node's preview closure makes, so we assert the wiring end-to-end:
		// building the node through createSchemaNode must carry the database, schema, name, and kind
		// through to previewObject.
		const calls: unknown[][] = [];
		const recordingHost = { ...noopHost, previewObject: async (...args: unknown[]) => { calls.push(args); return 'noop-dataset'; } };

		const schemaNode = createSchemaNode(mock, recordingHost, 'ANALYTICS', 'PUBLIC');
		const tables = await tablesOf(schemaNode);
		await tables[0].preview!();

		assert.deepStrictEqual(calls, [[mock, 'ANALYTICS', 'PUBLIC', 'T', 'table']]);
	});

	test('preview dataset ids do not collide for names containing delimiters', async () => {
		// datasetKey escapes each part with encodeURIComponent, then joins on ':'. Two independent
		// regressions could fold distinct objects onto one id, and each pair below guards one of them.
		// In both pairs the two names differ only in where the delimiter falls between schema and table,
		// so an unescaped/mis-joined key collapses them together while a correct key keeps all four apart.
		//   - ':' pair: the join delimiter itself. Without encodeURIComponent both fold onto ...:DB:a:b:c.
		//   - '.' pair: a regression of the join delimiter back to '.' would fold both onto ...DB.a.b.c.
		const captured: string[] = [];
		const recordingHost = { ...noopHost, openTableView: async (id: string) => { captured.push(id); } };
		const mock = createMockClient();
		const conn = new SnowflakeConnection(TEST_CONFIG, recordingHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = mock;

		await conn.previewObject(mock, 'DB', 'a:b', 'c', 'table');
		await conn.previewObject(mock, 'DB', 'a', 'b:c', 'table');
		await conn.previewObject(mock, 'DB', 'a.b', 'c', 'table');
		await conn.previewObject(mock, 'DB', 'a', 'b.c', 'table');

		assert.strictEqual(new Set(captured).size, 4, 'each object should get a distinct dataset id');
		await conn.disconnect();
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
		connectAsync(cb: (err: any, conn: any) => void) { this.connectCount++; cb(undefined, this); return Promise.resolve(this); }
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
		const factory: SnowflakeConnectionFactory = async () => {
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
		const factory: SnowflakeConnectionFactory = async () => {
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

	test('async-auth connect settles from the returned promise even when the callback never fires', async () => {
		// Reproduces the hang: connectAsync rejects its promise without ever invoking the callback, as
		// the browser-SSO / OAuth failure paths can. Callback-only wiring would wait for the SDK's
		// internal timeout; consuming the returned promise rejects promptly.
		const authError = Object.assign(new Error('Incorrect username or password was specified'), { code: '390100' });
		const factory: SnowflakeConnectionFactory = async () => {
			// eslint-disable-next-line local/code-no-any-casts
			return {
				connect: (cb: (err: any, conn: any) => void) => cb(authError, undefined),
				connectAsync: () => Promise.reject(authError),
				execute: (opts: any) => opts.complete(undefined, {}, []),
				destroy: (cb: (err: any, conn: any) => void) => cb(undefined, undefined),
			} as any;
		};
		const client = new SnowflakeClient({ ...OPTIONS, authenticator: 'EXTERNALBROWSER' }, factory, async () => { });

		await assert.rejects(() => client.connect(), /username or password/);
	});

	// A fake sdk connection whose connect can be gated on an external promise, so a test can hold the
	// client in the reconnect window (`_conn` null, `_open` pending) and act during it. `dead` makes the
	// first execute report a dead-session error to trigger a reconnect; otherwise execute returns rows.
	function gatedConn(opts: { connectGate?: Promise<void>; dead?: boolean }) {
		const state = { destroyCount: 0 };
		const conn = {
			connect: (cb: (err: any, c: any) => void) => {
				if (opts.connectGate) { opts.connectGate.then(() => cb(undefined, conn)); } else { cb(undefined, conn); }
			},
			connectAsync: (cb?: (err: any, c: any) => void) => { cb?.(undefined, conn); return Promise.resolve(conn); },
			execute: (o: { complete: (err: any, stmt: any, rows: any) => void }) => {
				if (opts.dead) { o.complete(new Error('Connection terminated unexpectedly'), {}, undefined); } else { o.complete(undefined, {}, [{ ok: true }]); }
			},
			destroy: (cb: (err: any, c: any) => void) => { state.destroyCount++; cb(undefined, conn); },
		};
		return { conn, state };
	}

	// Flushes pending microtasks/timers so the client settles into the reconnect window before a test
	// acts (the reconnect's destroy + open callbacks resolve on the microtask/timer queue).
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	test('a query starting during a reconnect waits for it instead of failing as closed', async () => {
		let openReplacement!: () => void;
		const connectGate = new Promise<void>(resolve => { openReplacement = resolve; });
		const first = gatedConn({ dead: true });
		const replacement = gatedConn({ connectGate });
		const built = [first, replacement];
		let n = 0;
		// eslint-disable-next-line local/code-no-any-casts
		const factory: SnowflakeConnectionFactory = async () => built[n++].conn as any;
		const client = new SnowflakeClient(OPTIONS, factory, async () => { });
		await client.connect();

		// Query A hits the dead session and drives the reconnect; the replacement's connect is gated, so
		// the client sits in the window with `_conn` null and `_reconnecting` pending.
		const qa = client.query('SELECT A');
		await settle();
		// Query B starts squarely in that window; it must await the reconnect, not fail as closed.
		const qb = client.query('SELECT B');
		openReplacement();

		const [ra, rb] = await Promise.all([qa, qb]);
		assert.deepStrictEqual([ra.rows, rb.rows], [[{ ok: true }], [{ ok: true }]]);
	});

	test('end() during a reconnect tears down the connection the reconnect installs', async () => {
		let openReplacement!: () => void;
		const connectGate = new Promise<void>(resolve => { openReplacement = resolve; });
		const first = gatedConn({ dead: true });
		const replacement = gatedConn({ connectGate });
		const built = [first, replacement];
		let n = 0;
		// eslint-disable-next-line local/code-no-any-casts
		const factory: SnowflakeConnectionFactory = async () => built[n++].conn as any;
		const client = new SnowflakeClient(OPTIONS, factory, async () => { });
		await client.connect();

		const qa = client.query('SELECT A');
		await settle();
		// Close mid-reconnect, then let the replacement finish connecting.
		const ending = client.end();
		openReplacement();
		await ending;

		// The connection the reconnect brought up must not survive the close, and the client stays closed.
		assert.strictEqual(replacement.state.destroyCount, 1, 'the reconnect-installed connection is destroyed');
		await assert.rejects(() => qa, /closed/);
		await assert.rejects(() => client.query('SELECT C'), /closed/);
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

	test('non-.com realm host suffix is stripped', () => {
		assert.strictEqual(parseSnowflakeAccount('https://myorg-myacct.snowflakecomputing.cn'), 'myorg-myacct');
	});

	test('Snowsight console URL resolves to the upper-cased org-account identifier', () => {
		assert.strictEqual(
			parseSnowflakeAccount('https://app.snowflake.com/duloftf/posit_software_pbc_dev/'),
			'DULOFTF-POSIT_SOFTWARE_PBC_DEV'
		);
	});
});

suite('Snowflake Lazy SDK Loading', () => {
	// The SDK is reached through a dynamic import() inside the default factory rather than a
	// top-level import, so that opening the Data Connections pane does not pay to load it. That
	// import is resolved at runtime against the real package, so an export the module namespace does
	// not actually carry still type-checks and only fails at the user's first connect. snowflake-sdk
	// is CommonJS with no `exports` map, which is exactly that case: its named exports are invisible
	// to Node's ESM loader and only reachable through the namespace's `default`.
	test('the default factory builds a real connection from the deferred import', async () => {
		const conn = await defaultConnectionFactory({
			account: 'myorg-myacct',
			username: 'testuser',
			password: 'testpass',
		});
		assert.deepStrictEqual(
			{ execute: typeof conn.execute, connectAsync: typeof conn.connectAsync },
			{ execute: 'function', connectAsync: 'function' });
	});
});

// --- Semantic views ---

// One row of DESCRIBE SEMANTIC VIEW output: a single property of a single member.
function describeRow(objectKind: string | null, objectName: string, parentEntity: string | null, property: string, propertyValue: string) {
	return { object_kind: objectKind, object_name: objectName, parent_entity: parentEntity, property, property_value: propertyValue };
}

// The Cortex Analyst extension of the DEMO_CHAOS_DB.ERP_DUMP.CHAOS_MODEL semantic view, trimmed to
// what the driver reads. Its table names are deliberately in lowercase here, to show they are
// matched to DESCRIBE's spelling rather than trusted as-is.
const CHAOS_MODEL_EXTENSION = JSON.stringify({
	tables: [
		{
			name: 'ref_entities',
			filters: [{
				name: 'IS_EXTERNAL',
				synonyms: ['Billed Accounts', 'External Customers'],
				description: 'Filters for true external customers only.',
				expr: `ACC_TYPE_CD = 'EXT'`,
			}],
		},
		{ name: 't_data_log', time_dimensions: [{ name: 'LOG_DT' }] },
		// A table DESCRIBE doesn't report: its filter has nowhere to be shown.
		{ name: 'retired_table', filters: [{ name: 'ORPHANED', expr: 'TRUE' }] },
	],
});

// DESCRIBE SEMANTIC VIEW rows modeled on CHAOS_MODEL: two logical tables, a relationship, facts,
// dimensions, and a metric. A few rows are planted to pin down behavior:
// - Z_STATUS comes before ACC_TYPE_CD, so a parser that sorted by name rather than keeping
//   definition order would show.
// - LOG_DT is typed VARCHAR, so its being a time dimension has to come from the extension.
// - CREATED_DT is typed DATE but not listed in T_DATA_LOG's time_dimensions, so it has to stay an
//   ordinary dimension: the extension decides for a table whose entry lists time dimensions.
// - OPENED_DT is typed DATE on REF_ENTITIES, whose extension entry lists none, so it falls back to
//   the data type and is a time dimension.
const CHAOS_MODEL_ROWS = [
	describeRow(null, 'CHAOS_MODEL', null, 'COMMENT', 'A chaotic model'),
	describeRow('TABLE', 'REF_ENTITIES', null, 'BASE_TABLE_DATABASE_NAME', 'DEMO_CHAOS_DB'),
	describeRow('TABLE', 'REF_ENTITIES', null, 'BASE_TABLE_SCHEMA_NAME', 'ERP_DUMP'),
	describeRow('TABLE', 'REF_ENTITIES', null, 'BASE_TABLE_NAME', 'REF_ENTITIES'),
	describeRow('TABLE', 'T_DATA_LOG', null, 'BASE_TABLE_NAME', 'T_DATA_LOG'),
	describeRow('RELATIONSHIP', 'LINK_TRANSACTIONS_TO_ENTITIES', 'T_DATA_LOG', 'TABLE', 'T_DATA_LOG'),
	describeRow('RELATIONSHIP', 'LINK_TRANSACTIONS_TO_ENTITIES', 'T_DATA_LOG', 'REF_TABLE', 'REF_ENTITIES'),
	describeRow('RELATIONSHIP', 'LINK_TRANSACTIONS_TO_ENTITIES', 'T_DATA_LOG', 'FOREIGN_KEY', '["E_KEY"]'),
	describeRow('RELATIONSHIP', 'LINK_TRANSACTIONS_TO_ENTITIES', 'T_DATA_LOG', 'REF_KEY', '["REF_KEY"]'),
	describeRow('FACT', 'RUNNING_BAL', 'REF_ENTITIES', 'DATA_TYPE', 'NUMBER(12,2)'),
	describeRow('DIMENSION', 'Z_STATUS', 'REF_ENTITIES', 'DATA_TYPE', 'VARCHAR(1)'),
	describeRow('DIMENSION', 'ACC_TYPE_CD', 'REF_ENTITIES', 'DATA_TYPE', 'VARCHAR(3)'),
	describeRow('DIMENSION', 'ACC_TYPE_CD', 'REF_ENTITIES', 'EXPRESSION', 'ACC_TYPE_CD'),
	describeRow('DIMENSION', 'OPENED_DT', 'REF_ENTITIES', 'DATA_TYPE', 'DATE'),
	describeRow('DIMENSION', 'E_KEY', 'T_DATA_LOG', 'DATA_TYPE', 'NUMBER(38,0)'),
	describeRow('DIMENSION', 'LOG_DT', 'T_DATA_LOG', 'DATA_TYPE', 'VARCHAR(10)'),
	describeRow('DIMENSION', 'CREATED_DT', 'T_DATA_LOG', 'DATA_TYPE', 'DATE'),
	describeRow('METRIC', 'NET_REVENUE', 'T_DATA_LOG', 'DATA_TYPE', 'NUMBER(37,4)'),
	describeRow('METRIC', 'NET_REVENUE', 'T_DATA_LOG', 'EXPRESSION', 'SUM(X_AMT)'),
	describeRow('EXTENSION', 'CA', null, 'VALUE', CHAOS_MODEL_EXTENSION),
];

// The members' names in each bucket, table-qualified where they have a table, for comparing a
// parse against what it should have produced.
function memberNames(members: ReturnType<typeof parseSemanticViewDescription>) {
	const names = (bucket: { name: string; table?: string }[]) => bucket.map(member => member.table ? `${member.table}.${member.name}` : member.name);
	return {
		tables: names(members.tables),
		dimensions: names(members.dimensions),
		timeDimensions: names(members.timeDimensions),
		facts: names(members.facts),
		namedFilters: names(members.namedFilters),
		metrics: names(members.metrics),
		derivedMetrics: names(members.derivedMetrics),
		relationships: names(members.relationships),
	};
}

// A mock client answering the queries a semantic view's nodes make: SHOW SEMANTIC VIEWS, DESCRIBE
// SEMANTIC VIEW, and GET_DDL (which fails, as it would without a warehouse, when ddlError is set).
// Any other query fails loudly, so a renamed query shows up as an error rather than as empty groups.
function createSemanticViewClient(ddlError?: string, queries: { sql: string; binds?: any[] }[] = []): any {
	return createMockClient((sql, binds) => {
		queries.push({ sql, binds });
		if (sql.startsWith('SHOW SEMANTIC VIEWS')) {
			return { rows: [{ name: 'CHAOS_MODEL', owner: 'ACCOUNTADMIN' }] };
		}
		if (sql.startsWith('DESCRIBE SEMANTIC VIEW')) {
			return { rows: CHAOS_MODEL_ROWS };
		}
		if (sql.includes('GET_DDL')) {
			if (ddlError) {
				throw new Error(ddlError);
			}
			return { rows: [{ DDL: 'create or replace semantic view CHAOS_MODEL' }] };
		}
		throw new Error(`Unexpected query: ${sql}`);
	});
}

// Expands a schema to its one semantic view node.
async function semanticViewOf(client: any): Promise<positron.DataConnectionNode> {
	const groups = await createSchemaNode(client, noopHost, 'DEMO_CHAOS_DB', 'ERP_DUMP').getChildren!();
	const semanticViewsGroup = groups.find(group => group.kind === positron.DataConnectionNodeKind.GroupSemanticViews)!;
	const [semanticView] = await semanticViewsGroup.getChildren!();
	return semanticView;
}

suite('Snowflake Semantic Views', () => {
	test('DESCRIBE rows are merged into one member each, bucketed by kind, in definition order', () => {
		const members = parseSemanticViewDescription(CHAOS_MODEL_ROWS);

		assert.deepStrictEqual(memberNames(members), {
			tables: ['REF_ENTITIES', 'T_DATA_LOG'],
			dimensions: ['REF_ENTITIES.Z_STATUS', 'REF_ENTITIES.ACC_TYPE_CD', 'T_DATA_LOG.E_KEY', 'T_DATA_LOG.CREATED_DT'],
			timeDimensions: ['REF_ENTITIES.OPENED_DT', 'T_DATA_LOG.LOG_DT'],
			facts: ['REF_ENTITIES.RUNNING_BAL'],
			// ORPHANED names a table DESCRIBE doesn't report, so it is dropped.
			namedFilters: ['REF_ENTITIES.IS_EXTERNAL'],
			metrics: ['T_DATA_LOG.NET_REVENUE'],
			derivedMetrics: [],
			relationships: ['T_DATA_LOG.LINK_TRANSACTIONS_TO_ENTITIES'],
		});
		assert.deepStrictEqual(Object.fromEntries(members.metrics[0].properties), { DATA_TYPE: 'NUMBER(37,4)', EXPRESSION: 'SUM(X_AMT)' });
	});

	test('the Cortex Analyst extension supplies named filters and decides time dimensions', () => {
		const members = parseSemanticViewDescription(CHAOS_MODEL_ROWS);

		// Attached to the table as DESCRIBE spells it, with the filter's definition as its properties.
		const [filter] = members.namedFilters;
		assert.deepStrictEqual(
			{ table: filter.table, properties: Object.fromEntries(filter.properties) },
			{
				table: 'REF_ENTITIES',
				properties: {
					EXPRESSION: `ACC_TYPE_CD = 'EXT'`,
					COMMENT: 'Filters for true external customers only.',
					SYNONYMS: '["Billed Accounts","External Customers"]',
				},
			});
		// LOG_DT is typed VARCHAR, so only the extension can have made it a time dimension; CREATED_DT
		// is typed DATE, but T_DATA_LOG's list leaves it out, so it stays an ordinary dimension; and
		// OPENED_DT's table lists no time dimensions at all, so its DATE type decides.
		assert.deepStrictEqual(members.timeDimensions.map(dimension => dimension.name), ['OPENED_DT', 'LOG_DT']);
		assert.ok(members.dimensions.some(dimension => dimension.name === 'CREATED_DT'));
	});

	test('without an extension, date-typed dimensions are time dimensions and table-less metrics are derived', () => {
		const members = parseSemanticViewDescription([
			describeRow('DIMENSION', 'LOG_DT', 'T_DATA_LOG', 'DATA_TYPE', 'DATE'),
			describeRow('DIMENSION', 'STS_CD', 'T_DATA_LOG', 'DATA_TYPE', 'NUMBER(2,0)'),
			describeRow('METRIC', 'NET_REVENUE', 'T_DATA_LOG', 'DATA_TYPE', 'NUMBER(37,4)'),
			describeRow('METRIC', 'REVENUE_PER_ENTITY', null, 'EXPRESSION', 'NET_REVENUE / ENTITY_COUNT'),
		]);

		assert.deepStrictEqual(
			{
				timeDimensions: memberNames(members).timeDimensions,
				dimensions: memberNames(members).dimensions,
				metrics: memberNames(members).metrics,
				derivedMetrics: memberNames(members).derivedMetrics,
			},
			{
				timeDimensions: ['T_DATA_LOG.LOG_DT'],
				dimensions: ['T_DATA_LOG.STS_CD'],
				metrics: ['T_DATA_LOG.NET_REVENUE'],
				derivedMetrics: ['REVENUE_PER_ENTITY'],
			});
	});

	test('a semantic view expands to Snowsight\'s layout, with members under their logical table', async () => {
		const semanticView = await semanticViewOf(createSemanticViewClient());
		const groups = await semanticView.getChildren!();
		const [refEntities] = await groups[0].getChildren!();
		const tableGroups = await refEntities.getChildren!();
		const membersOf = async (kind: positron.DataConnectionNodeKind) =>
			(await tableGroups.find(group => group.kind === kind)!.getChildren!()).map(member => member.name);

		assert.deepStrictEqual(
			{
				view: groups.map(group => group.name),
				table: refEntities.name,
				baseTable: refEntities.dataType,
				tableGroups: tableGroups.map(group => group.name),
				// Only REF_ENTITIES' own members: no T_DATA_LOG dimensions, and no NET_REVENUE.
				dimensions: await membersOf(positron.DataConnectionNodeKind.GroupDimensions),
				metrics: await membersOf(positron.DataConnectionNodeKind.GroupMetrics),
				namedFilters: await membersOf(positron.DataConnectionNodeKind.GroupNamedFilters),
			},
			{
				view: ['Logical Tables', 'Derived Metrics', 'Relationships'],
				table: 'REF_ENTITIES',
				baseTable: 'DEMO_CHAOS_DB.ERP_DUMP.REF_ENTITIES',
				tableGroups: ['Dimensions', 'Time Dimensions', 'Facts', 'Named Filters', 'Metrics'],
				dimensions: ['Z_STATUS', 'ACC_TYPE_CD'],
				metrics: [],
				namedFilters: ['IS_EXTERNAL'],
			});
	});

	test('a semantic view\'s Definition holds its DDL, fetched with its name as a bind', async () => {
		const queries: { sql: string; binds?: any[] }[] = [];
		const semanticView = await semanticViewOf(createSemanticViewClient(undefined, queries));
		const details = await semanticView.getDetails!();

		assert.deepStrictEqual(
			details.tabs!.find(tab => tab.title === 'Definition')!.sections,
			[{ kind: 'code', languageId: 'sql', code: 'create or replace semantic view CHAOS_MODEL' }]);
		// A bind, not a string literal, so no name can break out of (or be misread inside) the quotes.
		assert.deepStrictEqual(
			queries.filter(query => query.sql.includes('GET_DDL')).map(query => query.binds),
			[['"DEMO_CHAOS_DB"."ERP_DUMP"."CHAOS_MODEL"']]);
	});

	test('a semantic view describes itself once however often it is expanded and clicked', async () => {
		const queries: { sql: string; binds?: any[] }[] = [];
		const semanticView = await semanticViewOf(createSemanticViewClient(undefined, queries));

		await semanticView.getChildren!();
		await semanticView.getDetails!();
		await semanticView.getDetails!();

		assert.deepStrictEqual(
			{
				describes: queries.filter(query => query.sql.startsWith('DESCRIBE')).length,
				ddls: queries.filter(query => query.sql.includes('GET_DDL')).length,
			},
			{ describes: 1, ddls: 1 });
	});

	test('a semantic view\'s details still show the Overview when its DDL cannot be fetched', async () => {
		const semanticView = await semanticViewOf(createSemanticViewClient('No active warehouse selected in the current session.'));
		const details = await semanticView.getDetails!();

		const [overview, definition] = details.tabs!;
		assert.deepStrictEqual(
			{
				tabs: details.tabs!.map(tab => tab.title),
				overviewHeadings: overview.sections.map(section => section.kind === 'group' ? section.title : section.kind),
				definition: definition.sections,
			},
			{
				tabs: ['Overview', 'Definition'],
				overviewHeadings: ['properties', 'Logical Tables', 'Derived Metrics', 'Relationships'],
				definition: [{ kind: 'properties', properties: [{ name: 'Unavailable', value: 'No active warehouse selected in the current session.' }] }],
			});
	});
});
