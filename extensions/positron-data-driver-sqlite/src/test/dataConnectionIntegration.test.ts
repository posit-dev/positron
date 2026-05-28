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

		test('getChildren returns tables and views', async () => {
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

			// Get the children and assert that there are three.
			const children = await conn.getChildren();
			assert.strictEqual(children.length, 3);

			// Get the tables and views and check that the correct number were returned.
			const tables = children.filter(c => c.kind === positron.DataConnectionNodeKind.Table);
			const views = children.filter(c => c.kind === positron.DataConnectionNodeKind.View);
			assert.strictEqual(tables.length, 2);
			assert.strictEqual(views.length, 1);

			// Test the table names and view name.
			const tableNames = tables.map(t => t.name).sort();
			assert.deepStrictEqual(tableNames, ['orders', 'users']);
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

			// Get the children, find the products node, and get its children.
			const children = await conn.getChildren();
			const productsNode = children.find(c => c.name === 'products');
			assert.ok(productsNode);
			assert.ok(productsNode.getChildren);

			// Get the fields and make sure there are 4.
			const fields = await productsNode.getChildren!();
			assert.strictEqual(fields.length, 4);

			// Check the id field.
			const idField = fields.find(f => f.name === 'id')!;
			assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(idField.dataType, 'INTEGER');

			// Check the name field.
			const nameField = fields.find(f => f.name === 'name')!;
			assert.strictEqual(nameField.dataType, 'TEXT');

			// Check the prixe field.
			const priceField = fields.find(f => f.name === 'price')!;
			assert.strictEqual(priceField.dataType, 'REAL');

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

			// Test view node.
			const children = await conn.getChildren();
			const viewNode = children.find(c => c.name === 'user_list');
			assert.ok(viewNode);
			assert.ok(viewNode.getChildren);

			// Test view fields.
			const fields = await viewNode.getChildren!();
			assert.strictEqual(fields.length, 2);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[1].name, 'name');

			// Disconnect.
			await conn.disconnect();
		});

		test('empty database returns no children', async () => {
			// Create a test DB.
			const dbPath = createTestDb('empty.db');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Test that there are no children.
			const children = await conn.getChildren();
			assert.strictEqual(children.length, 0);

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

			// Test the children count.
			const children = await conn.getChildren();
			assert.strictEqual(children.length, 1);

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
			//    -> RPC -> ext host $driverConnect -> SQLiteConnection
			const conn = await positron.dataConnections.connect('positron-data-driver-sqlite', {
				databasePath: dbPath,
				readOnly: false,
			});
			assert.strictEqual(await conn.isConnected(), true);

			// 4. Browse the schema tree (each call goes through the
			//    main thread and back to the ext host).
			const topLevel = await conn.getChildren();
			assert.strictEqual(topLevel.length, 2);

			// Test employees.
			const employeesNode = topLevel.find(n => n.name === 'employees')!;
			assert.strictEqual(employeesNode.kind, positron.DataConnectionNodeKind.Table);
			assert.ok(employeesNode.getChildren);

			// Test employees fields.
			const fields = await employeesNode.getChildren!();
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

			// Test department_count/
			const viewNode = topLevel.find(n => n.name === 'department_count')!;
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);
			const viewFields = await viewNode.getChildren!();
			assert.strictEqual(viewFields.length, 2);

			// 5. Disconnect.
			await conn.disconnect();
			assert.strictEqual(await conn.isConnected(), false);
		});
	});
});
