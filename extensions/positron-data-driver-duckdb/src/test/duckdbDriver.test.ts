/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as positron from 'positron';
import { DuckDBInstance } from '@duckdb/node-api';
import { DuckDBConnection, DuckDBConnectionConfig } from '../duckdbConnection.js';

suite('DuckDB Driver Tests', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-duckdb-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Creates a temp DuckDB database, optionally runs setup SQL, and returns its path.
	async function createTestDb(name: string, sql?: string): Promise<string> {
		const dbPath = path.join(tmpDir, name);
		const instance = await DuckDBInstance.create(dbPath);
		const client = await instance.connect();
		if (sql) {
			await client.runAndReadAll(sql);
		}
		client.closeSync();
		instance.closeSync();
		return dbPath;
	}

	// A no-op Data Explorer host: these tests exercise schema browsing, not previewing, and a real
	// handler would register a vscode command that collides with the activated extension's.
	const dataExplorerHost = {
		openTableView: async () => { },
		openColumnView: async () => { },
		closeTableView: () => { },
	};

	// Opens a DuckDBConnection with the given config.
	async function connect(config: DuckDBConnectionConfig): Promise<DuckDBConnection> {
		const conn = new DuckDBConnection(config, dataExplorerHost);
		await conn.connect();
		return conn;
	}

	// Walks getChildren() down to the named schema node (default 'main').
	async function getSchemaNode(conn: DuckDBConnection, schemaName = 'main'): Promise<positron.DataConnectionNode> {
		const [schemasGroup] = await conn.getChildren();
		const schemas = await schemasGroup.getChildren!();
		const schema = schemas.find(s => s.name === schemaName);
		assert.ok(schema, `schema '${schemaName}' should exist`);
		return schema;
	}

	// Returns the named category group under a parent node: 'Tables'/'Views' under a schema, or
	// 'Columns'/'Indexes' under a table or view.
	async function getGroup(parent: positron.DataConnectionNode, groupName: string): Promise<positron.DataConnectionNode> {
		const groups = await parent.getChildren!();
		const group = groups.find(g => g.name === groupName);
		assert.ok(group, `group '${groupName}' should exist`);
		return group;
	}

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const dbPath = await createTestDb('basic.duckdb');
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		assert.strictEqual(await conn.isConnected(), true);
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('disconnect is idempotent', async () => {
		const dbPath = await createTestDb('idempotent.duckdb');
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect to non-existent file in read-only mode throws', async () => {
		await assert.rejects(
			() => connect({ databasePath: path.join(tmpDir, 'nonexistent.duckdb'), readOnly: true }),
			/Failed to open DuckDB database/
		);
	});

	// --- Empty database ---

	test('empty database has no tables or views', async () => {
		const dbPath = await createTestDb('empty.duckdb');
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);
		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		const views = await (await getGroup(schema, 'Views')).getChildren!();
		assert.strictEqual(tables.length, 0);
		assert.strictEqual(views.length, 0);

		await conn.disconnect();
	});

	// --- Tables and views ---

	test('schema lists tables and views', async () => {
		const dbPath = await createTestDb('tables.duckdb', `
			CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, email VARCHAR);
			CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total DOUBLE);
			CREATE VIEW user_orders AS
				SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;
		`);
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);

		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		const tableNames = tables.map(t => t.name).sort();
		assert.deepStrictEqual(tableNames, ['orders', 'users']);
		assert.ok(tables.every(t => t.kind === positron.DataConnectionNodeKind.Table));

		const views = await (await getGroup(schema, 'Views')).getChildren!();
		assert.deepStrictEqual(views.map(v => v.name), ['user_orders']);
		assert.strictEqual(views[0].kind, positron.DataConnectionNodeKind.View);

		await conn.disconnect();
	});

	// --- Field nodes ---

	test('table Columns group expands to field nodes with types', async () => {
		const dbPath = await createTestDb('fields.duckdb', `
			CREATE TABLE products (
				id INTEGER PRIMARY KEY,
				name VARCHAR NOT NULL,
				price DOUBLE,
				in_stock BOOLEAN,
				created_at TIMESTAMP
			);
		`);
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);
		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		const productsNode = tables.find(t => t.name === 'products');
		assert.ok(productsNode);

		// A table expands to Columns and Indexes category groups.
		assert.deepStrictEqual((await productsNode.getChildren!()).map(g => g.name), ['Columns', 'Indexes']);

		const fields = await (await getGroup(productsNode, 'Columns')).getChildren!();
		assert.strictEqual(fields.length, 5);

		const idField = fields.find(f => f.name === 'id')!;
		assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
		assert.strictEqual(idField.dataType, 'INTEGER');

		const nameField = fields.find(f => f.name === 'name')!;
		assert.strictEqual(nameField.dataType, 'VARCHAR');

		const priceField = fields.find(f => f.name === 'price')!;
		assert.strictEqual(priceField.dataType, 'DOUBLE');

		// The id column is the primary key; the others are not.
		assert.strictEqual(idField.isPrimaryKey, true);
		assert.strictEqual(nameField.isPrimaryKey, false);

		// Field nodes are leaves (no children) but can be previewed as a single-column Data Explorer.
		assert.strictEqual(idField.getChildren, undefined);
		assert.strictEqual(typeof idField.preview, 'function');

		await conn.disconnect();
	});

	test('view Columns group expands to field nodes', async () => {
		const dbPath = await createTestDb('view-fields.duckdb', `
			CREATE TABLE people (id INTEGER, name VARCHAR);
			CREATE VIEW people_view AS SELECT id, name FROM people;
		`);
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);
		const views = await (await getGroup(schema, 'Views')).getChildren!();
		const viewNode = views.find(v => v.name === 'people_view');
		assert.ok(viewNode);

		// A view expands to a single Columns group.
		assert.deepStrictEqual((await viewNode.getChildren!()).map(g => g.name), ['Columns']);

		const fields = await (await getGroup(viewNode, 'Columns')).getChildren!();
		assert.deepStrictEqual(fields.map(f => f.name), ['id', 'name']);

		await conn.disconnect();
	});

	// --- Indexes (nested under their table) ---

	test('table Indexes group lists the table indexes', async () => {
		const dbPath = await createTestDb('indexes.duckdb', `
			CREATE TABLE people (id INTEGER, email VARCHAR, name VARCHAR);
			CREATE INDEX idx_people_name ON people (name);
		`);
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);
		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		const peopleNode = tables.find(t => t.name === 'people')!;

		const indexes = await (await getGroup(peopleNode, 'Indexes')).getChildren!();
		assert.deepStrictEqual(indexes.map(i => i.name), ['idx_people_name']);
		assert.strictEqual(indexes[0].kind, positron.DataConnectionNodeKind.Index);

		await conn.disconnect();
	});

	// --- Read-only mode ---

	test('read-only mode allows reads', async () => {
		const dbPath = await createTestDb('readonly.duckdb', 'CREATE TABLE data (val VARCHAR);');
		const conn = await connect({ databasePath: dbPath, readOnly: true });

		assert.strictEqual(await conn.isReadOnly(), true);
		const schema = await getSchemaNode(conn);
		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		assert.strictEqual(tables.length, 1);

		await conn.disconnect();
	});

	// --- getChildren after disconnect ---

	test('getChildren after disconnect throws', async () => {
		const dbPath = await createTestDb('disconnected.duckdb', 'CREATE TABLE t (x INTEGER);');
		const conn = await connect({ databasePath: dbPath, readOnly: false });
		await conn.disconnect();

		await assert.rejects(
			() => conn.getChildren(),
			/closed/
		);
	});

	// --- Preview ---

	test('preview does not throw', async () => {
		const dbPath = await createTestDb('preview.duckdb', 'CREATE TABLE t (x INTEGER);');
		const conn = await connect({ databasePath: dbPath, readOnly: false });

		const schema = await getSchemaNode(conn);
		const tables = await (await getGroup(schema, 'Tables')).getChildren!();
		assert.ok(tables[0].preview);
		await tables[0].preview!();

		await conn.disconnect();
	});
});
