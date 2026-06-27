/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import Database from 'better-sqlite3';

suite('Data Connection Integration', () => {
	// Temporary directory.
	let tmpDir: string;

	/**
	 * Setup the test.
	 */
	setup(async () => {
		// Set the temporary directory.
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-sqlite-integration-'));

		// Ensure the extension is activated so the driver is registered.
		await vscode.extensions.getExtension('positron.positron-data-driver-sqlite')?.activate();
	});

	/**
	 * Teardown the test.
	 */
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

	// Returns the children of the named top-level category group ('Tables' | 'Views').
	async function groupChildren(conn: positron.DataConnection, groupName: string): Promise<positron.DataConnectionNode[]> {
		const groups = await conn.getChildren();
		const group = groups.find(g => g.name === groupName);
		assert.ok(group, `group '${groupName}' should exist`);
		return group.getChildren!();
	}

	// Returns the children of a relation's named category group, navigating from the given
	// top-level group ('Tables' | 'Views') to the named relation, then into its category group
	// ('Columns' | 'Indexes').
	async function relationGroupChildren(conn: positron.DataConnection, topGroup: string, relationName: string, groupName: string): Promise<positron.DataConnectionNode[]> {
		const relations = await groupChildren(conn, topGroup);
		const relation = relations.find(r => r.name === relationName);
		assert.ok(relation, `'${relationName}' should exist under '${topGroup}'`);
		const groups = await relation.getChildren!();
		const group = groups.find(g => g.name === groupName);
		assert.ok(group, `group '${groupName}' should exist under '${relationName}'`);
		return group.getChildren!();
	}

	suite('Driver Discovery', () => {

		test('getDrivers returns the SQLite driver', async () => {
			// Get the drivers.
			const drivers = await positron.dataConnections.getDrivers();

			// Find the SQLite driver.
			const sqlite = drivers.find(d => d.id === 'positron-data-driver-sqlite');

			// Test that it was found and is named properly.
			assert.ok(sqlite, 'SQLite driver should be registered');
			assert.strictEqual(sqlite.name, 'SQLite');
		});

		test('SQLite driver has expected parameters', async () => {
			// Get the drivers and find the SQLite driver.
			const drivers = await positron.dataConnections.getDrivers();
			const sqlite = drivers.find(d => d.id === 'positron-data-driver-sqlite')!;

			// Test the parameters length.
			assert.strictEqual(sqlite.parameters.length, 2);

			// Check the path parameter.
			const pathParam = sqlite.parameters.find(p => p.id === 'databasePath');
			assert.ok(pathParam);
			assert.strictEqual(pathParam.type, 'file');

			// Check the read only parameter.
			const readOnlyParam = sqlite.parameters.find(p => p.id === 'readOnly');
			assert.ok(readOnlyParam);
			assert.strictEqual(readOnlyParam.type, 'boolean');
		});
	});

	suite('Connect and Browse', () => {

		test('connect returns a live connection', async () => {
			// Create a test DB.
			const dbPath = createTestDb('connect.db', (db) => {
				db.exec('CREATE TABLE t (x INT);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Test that connection worked.
			assert.ok(conn);
			assert.strictEqual(await conn.isConnected(), true);
			assert.strictEqual(await conn.isReadOnly(), false);

			// Disconnect.
			await conn.disconnect();
		});

		test('connect returns a live connection to a read only database', async () => {
			// Create a test DB.
			const dbPath = createTestDb('connect.db', (db) => {
				db.exec('CREATE TABLE t (x INT);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: true,
			});

			// Test that connection worked.
			assert.ok(conn);
			assert.strictEqual(await conn.isConnected(), true);
			assert.strictEqual(await conn.isReadOnly(), true);

			// Disconnect.
			await conn.disconnect();
		});

		test('groups list tables and views', async () => {
			// Create a test DB with two tables and one view.
			const dbPath = createTestDb('schema.db', (db) => {
				db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)');
				db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total REAL)');
				db.exec('CREATE VIEW user_orders AS SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Navigate into the Tables and Views groups.
			const tables = await groupChildren(conn, 'Tables');
			const views = await groupChildren(conn, 'Views');
			assert.strictEqual(tables.length, 2);
			assert.strictEqual(views.length, 1);

			// Test the table names and view name.
			assert.deepStrictEqual(tables.map(t => t.name).sort(), ['orders', 'users']);
			assert.strictEqual(views[0].name, 'user_orders');

			// Disconnect.
			await conn.disconnect();
		});

		test('table node expands to show fields with types', async () => {
			// Create a test DB with one table.
			const dbPath = createTestDb('fields.db', (db) => {
				db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL, in_stock BOOLEAN);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: true,
			});

			// Navigate to the products table; it expands to Columns and Indexes groups.
			const tables = await groupChildren(conn, 'Tables');
			const productsNode = tables.find(t => t.name === 'products');
			assert.ok(productsNode);
			assert.deepStrictEqual((await productsNode.getChildren!()).map(g => g.name), ['Columns', 'Indexes']);

			// Get the fields and make sure there are 4.
			const fields = await relationGroupChildren(conn, 'Tables', 'products', 'Columns');
			assert.strictEqual(fields.length, 4);

			// Check the id field.
			const idField = fields.find(f => f.name === 'id')!;
			assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(idField.dataType, 'INTEGER');

			// Check the name and price fields.
			assert.strictEqual(fields.find(f => f.name === 'name')!.dataType, 'TEXT');
			assert.strictEqual(fields.find(f => f.name === 'price')!.dataType, 'REAL');

			// Check that the field nodes are leaves.
			assert.strictEqual(idField.getChildren, undefined);

			// Disconnect.
			await conn.disconnect();
		});

		test('view node expands to show fields', async () => {
			// Create a test DB with one table and one view.
			const dbPath = createTestDb('view-fields.db', (db) => {
				db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
				db.exec('CREATE VIEW user_list AS SELECT id, name FROM users');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Navigate to the view node; it expands to a single Columns group.
			const views = await groupChildren(conn, 'Views');
			const viewNode = views.find(v => v.name === 'user_list');
			assert.ok(viewNode);
			assert.deepStrictEqual((await viewNode.getChildren!()).map(g => g.name), ['Columns']);

			// Test view fields. Columns under a view are never marked as primary keys, even though
			// the underlying 'id' column is the base table's primary key.
			const fields = await relationGroupChildren(conn, 'Views', 'user_list', 'Columns');
			assert.deepStrictEqual(fields.map(f => f.name), ['id', 'name']);
			assert.ok(fields.every(f => !f.isPrimaryKey), 'view columns are never primary keys');

			// Disconnect.
			await conn.disconnect();
		});

		test('empty database has empty groups', async () => {
			// Create a test DB.
			const dbPath = createTestDb('empty.db');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Test that the top-level groups exist but are empty.
			const groups = await conn.getChildren();
			assert.deepStrictEqual(groups.map(g => g.name), ['Tables', 'Views']);
			assert.strictEqual((await groupChildren(conn, 'Tables')).length, 0);

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('Connection Lifecycle', () => {

		test('disconnect then isConnected returns false', async () => {
			// Create a test DB.
			const dbPath = createTestDb('lifecycle.db', (db) => {
				db.exec('CREATE TABLE t (x INT);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Test that the connection is connected.
			assert.strictEqual(await conn.isConnected(), true);

			// Disconnect.
			await conn.disconnect();

			// Test that the connection is not connected.
			assert.strictEqual(await conn.isConnected(), false);
		});

		test('read-only mode allows reads and exposes isReadOnly', async () => {
			// Create a test DB.
			const dbPath = createTestDb('readonly.db', (db) => {
				db.exec('CREATE TABLE data (val TEXT);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: true,
			});

			// Test that the test DB is read only.
			assert.strictEqual(await conn.isReadOnly(), true);

			// Test the table count.
			assert.strictEqual((await groupChildren(conn, 'Tables')).length, 1);

			// Disconnect.
			await conn.disconnect();
		});

		test('read-write connection has isReadOnly false', async () => {
			// Create a test DB.
			const dbPath = createTestDb('readwrite.db', (db) => {
				db.exec('CREATE TABLE data (val TEXT);');
			});

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Test that the test DB is not read only.
			assert.strictEqual(await conn.isReadOnly(), false);

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('Full Lifecycle', () => {

		test('discover driver -> connect -> browse tree -> disconnect', async () => {
			// 1. Discover the SQLite driver via the main thread service.
			const drivers = await positron.dataConnections.getDrivers();
			const sqlite = drivers.find(d => d.id === 'positron-data-driver-sqlite');
			assert.ok(sqlite, 'SQLite driver should be registered');

			// 2. Create a real database with schema.
			const dbPath = createTestDb('full-lifecycle.db', (db) => {
				db.exec('CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT NOT NULL, department TEXT, salary REAL)');
				db.exec('CREATE VIEW department_count AS SELECT department, COUNT(*) as cnt FROM employees GROUP BY department');
			});

			// 3. Connect through the full stack:
			//    ext host -> main thread service -> main thread adapter
			//    -> RPC -> ext host $driverConnect -> SQLiteConnection -> worker process
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});
			assert.strictEqual(await conn.isConnected(), true);

			// 4. Browse the schema tree (each call goes through the
			//    main thread and back to the ext host, then over IPC to the worker).
			const tables = await groupChildren(conn, 'Tables');
			const employeesNode = tables.find(n => n.name === 'employees')!;
			assert.strictEqual(employeesNode.kind, positron.DataConnectionNodeKind.Table);

			// Test employees fields (under the Columns group).
			const fields = await relationGroupChildren(conn, 'Tables', 'employees', 'Columns');
			assert.strictEqual(fields.length, 4);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[0].dataType, 'INTEGER');
			assert.strictEqual(fields[1].name, 'name');
			assert.strictEqual(fields[1].dataType, 'TEXT');
			assert.strictEqual(fields[3].name, 'salary');
			assert.strictEqual(fields[3].dataType, 'REAL');

			// Test that fields are leaves.
			assert.strictEqual(fields[0].kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(fields[0].getChildren, undefined);

			// Test department_count.
			const views = await groupChildren(conn, 'Views');
			const viewNode = views.find(n => n.name === 'department_count')!;
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);
			const viewFields = await relationGroupChildren(conn, 'Views', 'department_count', 'Columns');
			assert.strictEqual(viewFields.length, 2);

			// 5. Disconnect.
			await conn.disconnect();
			assert.strictEqual(await conn.isConnected(), false);
		});
	});
});
