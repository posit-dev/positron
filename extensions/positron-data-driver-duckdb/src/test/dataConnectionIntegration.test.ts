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
import { DuckDBInstance } from '@duckdb/node-api';

suite('Data Connection Integration', () => {
	// Temporary directory.
	let tmpDir: string;

	/**
	 * Setup the test.
	 */
	setup(async () => {
		// Set the temporary directory.
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-duckdb-integration-'));

		// Ensure the extension is activated so the driver is registered.
		await vscode.extensions.getExtension('positron.positron-data-driver-duckdb')?.activate();
	});

	/**
	 * Teardown the test.
	 */
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

	// Walks getChildren() down to the named schema node (default 'main').
	async function getSchemaNode(conn: positron.DataConnection, schemaName = 'main'): Promise<positron.DataConnectionNode> {
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

	suite('Driver Discovery', () => {

		test('getDrivers returns the DuckDB driver', async () => {
			// Get the drivers.
			const drivers = await positron.dataConnections.getDrivers();

			// Find the DuckDB driver.
			const duckdb = drivers.find(d => d.id === 'positron-data-driver-duckdb');

			// Test that it was found and is named properly.
			assert.ok(duckdb, 'DuckDB driver should be registered');
			assert.strictEqual(duckdb.name, 'DuckDB');
		});

		test('DuckDB driver has expected mechanisms and parameters', async () => {
			// Get the drivers and find the DuckDB driver.
			const drivers = await positron.dataConnections.getDrivers();
			const duckdb = drivers.find(d => d.id === 'positron-data-driver-duckdb')!;

			// Test the single 'file' mechanism.
			assert.strictEqual(duckdb.mechanisms.length, 1);
			const mechanism = duckdb.mechanisms.find(m => m.id === 'file')!;
			assert.ok(mechanism);

			// Test the parameters length.
			assert.strictEqual(mechanism.parameters.length, 2);

			// Check the path parameter.
			const pathParam = mechanism.parameters.find(p => p.id === 'databasePath');
			assert.ok(pathParam);
			assert.strictEqual(pathParam.type, 'file');

			// Check the read only parameter.
			const readOnlyParam = mechanism.parameters.find(p => p.id === 'readOnly');
			assert.ok(readOnlyParam);
			assert.strictEqual(readOnlyParam.type, 'boolean');
		});
	});

	suite('Connect and Browse', () => {

		test('connect returns a live connection', async () => {
			// Create a test DB.
			const dbPath = await createTestDb('connect.duckdb', 'CREATE TABLE t (x INTEGER);');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
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
			const dbPath = await createTestDb('connect-ro.duckdb', 'CREATE TABLE t (x INTEGER);');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
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
			const dbPath = await createTestDb('schema.duckdb', `
				CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR, email VARCHAR);
				CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total DOUBLE);
				CREATE VIEW user_orders AS SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id;
			`);

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
				databasePath: dbPath,
				readOnly: false,
			});

			// Browse to the main schema.
			const schema = await getSchemaNode(conn);

			// Get the tables and views and check that the correct number were returned.
			const tables = await (await getGroup(schema, 'Tables')).getChildren!();
			const views = await (await getGroup(schema, 'Views')).getChildren!();
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
			const dbPath = await createTestDb('fields.duckdb',
				'CREATE TABLE products (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, price DOUBLE, in_stock BOOLEAN);');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
				databasePath: dbPath,
				readOnly: true,
			});

			// Browse to the products table; it expands to Columns and Indexes groups.
			const schema = await getSchemaNode(conn);
			const tables = await (await getGroup(schema, 'Tables')).getChildren!();
			const productsNode = tables.find(t => t.name === 'products');
			assert.ok(productsNode);
			assert.deepStrictEqual((await productsNode.getChildren!()).map(g => g.name), ['Columns', 'Indexes']);

			// Get the fields and make sure there are 4.
			const fields = await (await getGroup(productsNode, 'Columns')).getChildren!();
			assert.strictEqual(fields.length, 4);

			// Check the id field.
			const idField = fields.find(f => f.name === 'id')!;
			assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(idField.dataType, 'INTEGER');

			// Check the name and price fields.
			assert.strictEqual(fields.find(f => f.name === 'name')!.dataType, 'VARCHAR');
			assert.strictEqual(fields.find(f => f.name === 'price')!.dataType, 'DOUBLE');

			// Check that the field nodes are leaves.
			assert.strictEqual(idField.getChildren, undefined);

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('Connection Lifecycle', () => {

		test('disconnect then isConnected returns false', async () => {
			// Create a test DB.
			const dbPath = await createTestDb('lifecycle.duckdb', 'CREATE TABLE t (x INTEGER);');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
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

		test('read-write connection has isReadOnly false', async () => {
			// Create a test DB.
			const dbPath = await createTestDb('readwrite.duckdb', 'CREATE TABLE data (val VARCHAR);');

			// Connect to the test DB.
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
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
			// 1. Discover the DuckDB driver via the main thread service.
			const drivers = await positron.dataConnections.getDrivers();
			const duckdb = drivers.find(d => d.id === 'positron-data-driver-duckdb');
			assert.ok(duckdb, 'DuckDB driver should be registered');

			// 2. Create a real database with schema.
			const dbPath = await createTestDb('full-lifecycle.duckdb', `
				CREATE TABLE employees (id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, department VARCHAR, salary DOUBLE);
				CREATE VIEW department_count AS SELECT department, COUNT(*) AS cnt FROM employees GROUP BY department;
			`);

			// 3. Connect through the full stack:
			//    ext host -> main thread service -> main thread adapter
			//    -> RPC -> ext host $driverConnect -> DuckDBConnection
			const conn = await positron.dataConnections.connect('positron-data-driver-duckdb', 'file', {
				databasePath: dbPath,
				readOnly: false,
			});
			assert.strictEqual(await conn.isConnected(), true);

			// 4. Browse the schema tree (each call goes through the
			//    main thread and back to the ext host).
			const schema = await getSchemaNode(conn);

			// Test employees table and its fields.
			const tables = await (await getGroup(schema, 'Tables')).getChildren!();
			const employeesNode = tables.find(n => n.name === 'employees')!;
			assert.strictEqual(employeesNode.kind, positron.DataConnectionNodeKind.Table);

			const fields = await (await getGroup(employeesNode, 'Columns')).getChildren!();
			assert.strictEqual(fields.length, 4);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[0].dataType, 'INTEGER');
			assert.strictEqual(fields[0].kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(fields[0].getChildren, undefined);

			// Test department_count view.
			const views = await (await getGroup(schema, 'Views')).getChildren!();
			const viewNode = views.find(n => n.name === 'department_count')!;
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);
			const viewFields = await (await getGroup(viewNode, 'Columns')).getChildren!();
			assert.strictEqual(viewFields.length, 2);

			// 5. Disconnect.
			await conn.disconnect();
			assert.strictEqual(await conn.isConnected(), false);
		});
	});
});
