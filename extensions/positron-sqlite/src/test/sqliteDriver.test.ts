/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import Database from 'better-sqlite3';
import { SQLiteConnection } from '../sqliteConnection.js';

suite('SQLite Driver Tests', () => {
	let tmpDir: string;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-sqlite-test-'));
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

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const dbPath = createTestDb('basic.db');
		const conn = new SQLiteConnection(dbPath, false);

		assert.strictEqual(await conn.isConnected(), true);
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('disconnect is idempotent', async () => {
		const dbPath = createTestDb('idempotent.db');
		const conn = new SQLiteConnection(dbPath, false);

		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect to non-existent file throws', () => {
		assert.throws(
			() => new SQLiteConnection('/nonexistent/path/db.sqlite', false),
			/Cannot open|does not exist/
		);
	});

	test('querying an invalid file throws', async () => {
		const badPath = path.join(tmpDir, 'notadb.txt');
		fs.writeFileSync(badPath, 'this is not a database');
		// SQLite opens the file handle lazily; the error surfaces on first query.
		const conn = new SQLiteConnection(badPath, false);
		await assert.rejects(
			() => conn.getChildren(),
			/not a database/
		);
	});

	// --- Empty database ---

	test('empty database returns no children', async () => {
		const dbPath = createTestDb('empty.db');
		const conn = new SQLiteConnection(dbPath, false);

		const children = await conn.getChildren();
		assert.strictEqual(children.length, 0);

		await conn.disconnect();
	});

	// --- Tables and views ---

	test('getChildren returns tables and views', async () => {
		const dbPath = createTestDb('tables.db', (db) => {
			db.exec(`
				CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
				CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL);
				CREATE VIEW user_orders AS
					SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;
			`);
		});

		const conn = new SQLiteConnection(dbPath, false);
		const children = await conn.getChildren();

		assert.strictEqual(children.length, 3);

		const tableNames = children
			.filter(c => c.kind === 'table')
			.map(c => c.name)
			.sort();
		assert.deepStrictEqual(tableNames, ['orders', 'users']);

		const viewNames = children
			.filter(c => c.kind === 'view')
			.map(c => c.name);
		assert.deepStrictEqual(viewNames, ['user_orders']);

		await conn.disconnect();
	});

	test('internal sqlite_ tables are hidden', async () => {
		const dbPath = createTestDb('internal.db', (db) => {
			db.exec(`
				CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
				INSERT INTO items (name) VALUES ('test');
			`);
		});

		const conn = new SQLiteConnection(dbPath, false);
		const children = await conn.getChildren();

		const names = children.map(c => c.name);
		assert.ok(!names.some(n => n.startsWith('sqlite_')),
			'Internal sqlite_ tables should be hidden');
		assert.ok(names.includes('items'));

		await conn.disconnect();
	});

	// --- Field nodes ---

	test('table getChildren returns field nodes with types', async () => {
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

		const conn = new SQLiteConnection(dbPath, false);
		const children = await conn.getChildren();
		const productsNode = children.find(c => c.name === 'products');
		assert.ok(productsNode, 'products table should exist');
		assert.ok(productsNode.getChildren, 'table node should have getChildren');

		const fields = await productsNode.getChildren!();
		assert.strictEqual(fields.length, 6);

		const idField = fields.find(f => f.name === 'id');
		assert.ok(idField);
		assert.strictEqual(idField.kind, 'field');
		assert.strictEqual(idField.dataType, 'INTEGER');

		const nameField = fields.find(f => f.name === 'name');
		assert.ok(nameField);
		assert.strictEqual(nameField.dataType, 'TEXT');

		const priceField = fields.find(f => f.name === 'price');
		assert.ok(priceField);
		assert.strictEqual(priceField.dataType, 'REAL');

		// Field nodes should be leaves.
		assert.strictEqual(idField.getChildren, undefined);
		assert.strictEqual(idField.preview, undefined);

		await conn.disconnect();
	});

	test('columns with empty type default to BLOB', async () => {
		const dbPath = createTestDb('notype.db', (db) => {
			db.exec('CREATE TABLE flex (value);');
		});

		const conn = new SQLiteConnection(dbPath, false);
		const children = await conn.getChildren();
		const flexNode = children.find(c => c.name === 'flex');
		assert.ok(flexNode);

		const fields = await flexNode.getChildren!();
		assert.strictEqual(fields[0].dataType, 'BLOB');

		await conn.disconnect();
	});

	// --- Read-only mode ---

	test('read-only mode allows reads', async () => {
		const dbPath = createTestDb('readonly.db', (db) => {
			db.exec('CREATE TABLE data (val TEXT);');
		});

		const conn = new SQLiteConnection(dbPath, true);
		const children = await conn.getChildren();
		assert.strictEqual(children.length, 1);

		await conn.disconnect();
	});

	// --- getChildren after disconnect ---

	test('getChildren after disconnect throws', async () => {
		const dbPath = createTestDb('disconnected.db', (db) => {
			db.exec('CREATE TABLE t (x INT);');
		});

		const conn = new SQLiteConnection(dbPath, false);
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

		const conn = new SQLiteConnection(dbPath, false);
		const children = await conn.getChildren();
		const tableNode = children[0];
		assert.ok(tableNode.preview);
		await tableNode.preview!();

		await conn.disconnect();
	});
});
