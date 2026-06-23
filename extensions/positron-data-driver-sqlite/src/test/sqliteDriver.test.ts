/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as positron from 'positron';
import Database from 'better-sqlite3';
import { SQLiteConnection } from '../sqliteConnection.js';

suite('SQLite Driver Tests', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-sqlite-test-'));
	});

	teardown(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	// Creates a temp SQLite database and returns its path.
	function createTestDb(name: string, setupFn?: (db: Database.Database) => void): string {
		const dbPath = path.join(tmpDir, name);
		const db = new Database(dbPath);
		if (setupFn) {
			setupFn(db);
		}
		db.close();
		return dbPath;
	}

	// A no-op Data Explorer host: these tests exercise schema browsing, not previewing, and a real
	// handler would register a vscode command that collides with the activated extension's.
	const dataExplorerHost = {
		openTableView: async () => { },
		openColumnView: async () => { },
		closeTableView: () => { },
	};

	// Opens a SQLiteConnection (constructing then connecting in the worker).
	async function connect(dbPath: string, readOnly = false): Promise<SQLiteConnection> {
		const conn = new SQLiteConnection(dbPath, readOnly, dataExplorerHost);
		await conn.connect();
		return conn;
	}

	// Returns the children of the named top-level category group ('Tables' | 'Views').
	async function groupChildren(conn: SQLiteConnection, groupName: string): Promise<positron.DataConnectionNode[]> {
		const groups = await conn.getChildren();
		const group = groups.find(g => g.name === groupName);
		assert.ok(group, `group '${groupName}' should exist`);
		return group.getChildren!();
	}

	// Returns the children of a table's named category group ('Columns' | 'Indexes').
	async function tableGroupChildren(conn: SQLiteConnection, tableName: string, groupName: string): Promise<positron.DataConnectionNode[]> {
		const tables = await groupChildren(conn, 'Tables');
		const table = tables.find(t => t.name === tableName);
		assert.ok(table, `table '${tableName}' should exist`);
		const groups = await table.getChildren!();
		const group = groups.find(g => g.name === groupName);
		assert.ok(group, `group '${groupName}' should exist under table '${tableName}'`);
		return group.getChildren!();
	}

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const dbPath = createTestDb('basic.db');
		const conn = await connect(dbPath);

		assert.strictEqual(await conn.isConnected(), true);
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('disconnect is idempotent', async () => {
		const dbPath = createTestDb('idempotent.db');
		const conn = await connect(dbPath);

		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect to non-existent file throws', async () => {
		await assert.rejects(
			() => connect('/nonexistent/path/db.sqlite', false),
			/Cannot open|does not exist/
		);
	});

	test('connecting to an invalid file throws', async () => {
		const badPath = path.join(tmpDir, 'notadb.txt');
		fs.writeFileSync(badPath, 'this is not a database');
		// better-sqlite3 validates the file as a database on first access, which
		// the connect() probe triggers; the worker error is mapped to a clean message.
		await assert.rejects(
			() => connect(badPath, false),
			/not a valid SQLite database/
		);
	});

	// --- Top-level groups ---

	test('top level is two category groups', async () => {
		const dbPath = createTestDb('groups.db');
		const conn = await connect(dbPath);

		const groups = await conn.getChildren();
		assert.deepStrictEqual(groups.map(g => g.name), ['Tables', 'Views']);

		await conn.disconnect();
	});

	test('empty database has empty groups', async () => {
		const dbPath = createTestDb('empty.db');
		const conn = await connect(dbPath);

		assert.strictEqual((await groupChildren(conn, 'Tables')).length, 0);
		assert.strictEqual((await groupChildren(conn, 'Views')).length, 0);

		await conn.disconnect();
	});

	// --- Tables and views ---

	test('groups list tables and views', async () => {
		const dbPath = createTestDb('tables.db', (db) => {
			db.exec(`
				CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
				CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);
				CREATE VIEW user_orders AS
					SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;
			`);
		});

		const conn = await connect(dbPath);

		const tables = await groupChildren(conn, 'Tables');
		assert.deepStrictEqual(tables.map(t => t.name).sort(), ['orders', 'users']);
		assert.ok(tables.every(t => t.kind === positron.DataConnectionNodeKind.Table));

		const views = await groupChildren(conn, 'Views');
		assert.deepStrictEqual(views.map(v => v.name), ['user_orders']);
		assert.strictEqual(views[0].kind, positron.DataConnectionNodeKind.View);

		await conn.disconnect();
	});

	test('internal sqlite_ tables are hidden', async () => {
		const dbPath = createTestDb('internal.db', (db) => {
			db.exec(`
				CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
				INSERT INTO items (name) VALUES ('test');
			`);
		});

		const conn = await connect(dbPath);
		const names = (await groupChildren(conn, 'Tables')).map(t => t.name);
		assert.ok(!names.some(n => n.startsWith('sqlite_')), 'Internal sqlite_ tables should be hidden');
		assert.ok(names.includes('items'));

		await conn.disconnect();
	});

	// --- Field nodes ---

	test('table Columns group expands to field nodes with types', async () => {
		const dbPath = createTestDb('fields.db', (db) => {
			db.exec(`
				CREATE TABLE products (
					id INTEGER PRIMARY KEY,
					name TEXT NOT NULL,
					price REAL,
					in_stock BOOLEAN,
					data BLOB,
					created_at DATETIME
				);
			`);
		});

		const conn = await connect(dbPath);

		// A table expands to Columns and Indexes category groups.
		const tables = await groupChildren(conn, 'Tables');
		const productsNode = tables.find(t => t.name === 'products');
		assert.ok(productsNode, 'products table should exist');
		assert.deepStrictEqual((await productsNode.getChildren!()).map(g => g.name), ['Columns', 'Indexes']);

		const fields = await tableGroupChildren(conn, 'products', 'Columns');
		assert.strictEqual(fields.length, 6);

		const idField = fields.find(f => f.name === 'id')!;
		assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
		assert.strictEqual(idField.dataType, 'INTEGER');
		assert.strictEqual(fields.find(f => f.name === 'name')!.dataType, 'TEXT');
		assert.strictEqual(fields.find(f => f.name === 'price')!.dataType, 'REAL');

		// The id column is the primary key; the others are not.
		assert.strictEqual(idField.isPrimaryKey, true);
		assert.strictEqual(fields.find(f => f.name === 'name')!.isPrimaryKey, false);

		// Field nodes are leaves (no children) but can be previewed as a single-column Data Explorer.
		assert.strictEqual(idField.getChildren, undefined);
		assert.strictEqual(typeof idField.preview, 'function');

		await conn.disconnect();
	});

	test('columns with empty type default to BLOB', async () => {
		const dbPath = createTestDb('notype.db', (db) => {
			db.exec('CREATE TABLE flex (value);');
		});

		const conn = await connect(dbPath);
		const fields = await tableGroupChildren(conn, 'flex', 'Columns');
		assert.strictEqual(fields[0].dataType, 'BLOB');

		await conn.disconnect();
	});

	// --- Indexes (nested under their table) ---

	test('table Indexes group lists the table indexes and excludes auto-indexes', async () => {
		const dbPath = createTestDb('indexes.db', (db) => {
			db.exec(`
				CREATE TABLE people (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT);
				CREATE INDEX idx_people_name ON people (name);
			`);
		});

		const conn = await connect(dbPath);

		// Only the explicitly-created index is listed; the sqlite_autoindex_* backing the UNIQUE
		// constraint is hidden.
		const indexes = await tableGroupChildren(conn, 'people', 'Indexes');
		assert.deepStrictEqual(indexes.map(i => i.name), ['idx_people_name']);
		assert.strictEqual(indexes[0].kind, positron.DataConnectionNodeKind.Index);

		// An index expands to the columns it covers.
		const indexColumns = await indexes[0].getChildren!();
		assert.deepStrictEqual(indexColumns.map(c => c.name), ['name']);

		await conn.disconnect();
	});

	// --- Read-only mode ---

	test('read-only mode allows reads', async () => {
		const dbPath = createTestDb('readonly.db', (db) => {
			db.exec('CREATE TABLE data (val TEXT);');
		});

		const conn = await connect(dbPath, true);
		assert.strictEqual(await conn.isReadOnly(), true);
		assert.strictEqual((await groupChildren(conn, 'Tables')).length, 1);

		await conn.disconnect();
	});

	// --- getChildren after disconnect ---

	test('getChildren after disconnect throws', async () => {
		const dbPath = createTestDb('disconnected.db', (db) => {
			db.exec('CREATE TABLE t (x INT);');
		});

		const conn = await connect(dbPath);
		await conn.disconnect();

		await assert.rejects(
			() => conn.getChildren(),
			/closed/
		);
	});

	// --- Preview ---

	test('preview does not throw', async () => {
		const dbPath = createTestDb('preview.db', (db) => {
			db.exec('CREATE TABLE t (x INT);');
		});

		const conn = await connect(dbPath);
		const tables = await groupChildren(conn, 'Tables');
		assert.ok(tables[0].preview);
		await tables[0].preview!();

		await conn.disconnect();
	});
});
