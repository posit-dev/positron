/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { Client } from 'pg';

/**
 * PostgreSQL Data Connection integration tests.
 *
 * These tests require a running PostgreSQL server. Connection parameters are
 * read from environment variables with sensible defaults for local development:
 *
 *   PGHOST     (default: localhost)
 *   PGPORT     (default: 5432)
 *   PGDATABASE (default: positron_test)
 *   PGUSER     (default: postgres)
 *   PGPASSWORD (default: empty)
 *
 * Each test suite creates and tears down a unique schema so tests are isolated
 * and can run in parallel without stepping on each other.
 */
suite('PostgreSQL Data Connection Integration', () => {
	// Connection parameters from environment or defaults.
	const pgHost = process.env.PGHOST ?? 'localhost';
	const pgPort = Number(process.env.PGPORT ?? 5432);
	const pgDatabase = process.env.PGDATABASE ?? 'positron_test';
	const pgUser = process.env.PGUSER ?? 'postgres';
	const pgPassword = process.env.PGPASSWORD ?? '';

	// A direct pg client for test setup/teardown.
	let setupClient: Client;

	// Unique schema name per test run to avoid collisions.
	let testSchema: string;

	/**
	 * Setup: connect a raw client, create an isolated schema, and activate the extension.
	 */
	setup(async function () {
		// Allow slow connection.
		this.timeout(10000);

		testSchema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

		setupClient = new Client({
			host: pgHost,
			port: pgPort,
			database: pgDatabase,
			user: pgUser,
			password: pgPassword,
		});

		try {
			await setupClient.connect();
		} catch (err: any) {
			this.skip(); // Skip all tests if PostgreSQL is not available.
			return;
		}

		// Create the isolated test schema.
		await setupClient.query(`CREATE SCHEMA "${testSchema}"`);

		// Ensure the extension is activated so the driver is registered.
		await vscode.extensions.getExtension('positron.positron-data-driver-postgresql')?.activate();
	});

	/**
	 * Teardown: drop the test schema and close the setup client.
	 */
	teardown(async function () {
		this.timeout(10000);
		if (setupClient) {
			try {
				await setupClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			} finally {
				await setupClient.end();
			}
		}
	});

	// Helper: connect to the test database via the Positron driver.
	async function connectDriver(): Promise<positron.DataConnection> {
		return positron.dataConnections.connect('positron-data-driver-postgresql', {
			host: pgHost,
			port: pgPort,
			database: pgDatabase,
			user: pgUser,
			password: pgPassword,
			ssl: false,
		});
	}

	// Helper: find a schema node by name in the connection's children.
	async function findSchemaNode(conn: positron.DataConnection, name: string): Promise<positron.DataConnectionNode> {
		const schemas = await conn.getChildren();
		const node = schemas.find(s => s.name === name);
		assert.ok(node, `Schema '${name}' not found`);
		return node;
	}

	suite('Driver Discovery', () => {

		test('getDrivers returns the PostgreSQL driver', async () => {
			// Get the drivers.
			const drivers = await positron.dataConnections.getDrivers();

			// Find the PostgreSQL driver.
			const pg = drivers.find(d => d.id === 'positron-data-driver-postgresql');

			// Test that it was found and is named properly.
			assert.ok(pg, 'PostgreSQL driver should be registered');
			assert.strictEqual(pg.name, 'PostgreSQL');
		});

		test('PostgreSQL driver has expected parameters', async () => {
			// Get the drivers and find the PostgreSQL driver.
			const drivers = await positron.dataConnections.getDrivers();
			const pg = drivers.find(d => d.id === 'positron-data-driver-postgresql')!;

			// Test the parameters length.
			assert.strictEqual(pg.parameters.length, 6);

			// Check the host parameter.
			const hostParam = pg.parameters.find(p => p.id === 'host');
			assert.ok(hostParam);
			assert.strictEqual(hostParam.type, 'string');

			// Check the port parameter.
			const portParam = pg.parameters.find(p => p.id === 'port');
			assert.ok(portParam);
			assert.strictEqual(portParam.type, 'number');

			// Check the database parameter.
			const dbParam = pg.parameters.find(p => p.id === 'database');
			assert.ok(dbParam);
			assert.strictEqual(dbParam.type, 'string');

			// Check the user parameter.
			const userParam = pg.parameters.find(p => p.id === 'user');
			assert.ok(userParam);
			assert.strictEqual(userParam.type, 'string');

			// Check the password parameter.
			const pwParam = pg.parameters.find(p => p.id === 'password');
			assert.ok(pwParam);
			assert.strictEqual(pwParam.type, 'string');

			// Check the SSL parameter.
			const sslParam = pg.parameters.find(p => p.id === 'ssl');
			assert.ok(sslParam);
			assert.strictEqual(sslParam.type, 'boolean');
		});
	});

	suite('Connect and Browse', () => {

		test('connect returns a live connection', async function () {
			this.timeout(10000);

			// Connect to the test DB.
			const conn = await connectDriver();

			// Test that connection worked.
			assert.ok(conn);
			assert.strictEqual(await conn.isConnected(), true);
			assert.strictEqual(await conn.isReadOnly(), false);

			// Disconnect.
			await conn.disconnect();
		});

		test('getChildren returns schemas including the test schema', async function () {
			this.timeout(10000);

			// Connect to the test DB.
			const conn = await connectDriver();

			// Get the children (schemas).
			const schemas = await conn.getChildren();

			// The test schema should be present.
			const testSchemaNode = schemas.find(s => s.name === testSchema);
			assert.ok(testSchemaNode, 'Test schema should appear in getChildren');
			assert.strictEqual(testSchemaNode.kind, positron.DataConnectionNodeKind.Schema);

			// System schemas should be excluded.
			const pgCatalog = schemas.find(s => s.name === 'pg_catalog');
			assert.strictEqual(pgCatalog, undefined, 'pg_catalog should be excluded');

			const infoSchema = schemas.find(s => s.name === 'information_schema');
			assert.strictEqual(infoSchema, undefined, 'information_schema should be excluded');

			// Disconnect.
			await conn.disconnect();
		});

		test('schema node expands to show tables and views', async function () {
			this.timeout(10000);

			// Create tables and a view in the test schema.
			await setupClient.query(`CREATE TABLE "${testSchema}".users (id serial PRIMARY KEY, name text, email varchar(255))`);
			await setupClient.query(`CREATE TABLE "${testSchema}".orders (id serial PRIMARY KEY, user_id integer, total numeric(10,2))`);
			await setupClient.query(`CREATE VIEW "${testSchema}".user_orders AS SELECT u.name, o.total FROM "${testSchema}".users u JOIN "${testSchema}".orders o ON u.id = o.user_id`);

			// Connect and find the test schema.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);

			// Expand the schema to get tables and views.
			const children = await schemaNode.getChildren!();

			// Check tables.
			const tables = children.filter(c => c.kind === positron.DataConnectionNodeKind.Table);
			const tableNames = tables.map(t => t.name).sort();
			assert.deepStrictEqual(tableNames, ['orders', 'users']);

			// Check views.
			const views = children.filter(c => c.kind === positron.DataConnectionNodeKind.View);
			assert.strictEqual(views.length, 1);
			assert.strictEqual(views[0].name, 'user_orders');

			// Disconnect.
			await conn.disconnect();
		});

		test('table node expands to show fields with PostgreSQL types', async function () {
			this.timeout(10000);

			// Create a table with a variety of PostgreSQL types.
			await setupClient.query(`
				CREATE TABLE "${testSchema}".products (
					id serial PRIMARY KEY,
					name varchar(100) NOT NULL,
					description text,
					price numeric(10,2),
					quantity integer,
					is_active boolean,
					created_at timestamp with time zone,
					tags text[],
					metadata jsonb
				)
			`);

			// Connect and navigate to the table.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const children = await schemaNode.getChildren!();
			const productsNode = children.find(c => c.name === 'products');
			assert.ok(productsNode);

			// Expand the table to get fields.
			const fields = await productsNode.getChildren!();
			assert.strictEqual(fields.length, 9);

			// Check specific field types.
			const idField = fields.find(f => f.name === 'id')!;
			assert.strictEqual(idField.kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(idField.dataType, 'integer');

			const nameField = fields.find(f => f.name === 'name')!;
			assert.strictEqual(nameField.dataType, 'character varying(100)');

			const descField = fields.find(f => f.name === 'description')!;
			assert.strictEqual(descField.dataType, 'text');

			const priceField = fields.find(f => f.name === 'price')!;
			assert.strictEqual(priceField.dataType, 'numeric(10,2)');

			const quantityField = fields.find(f => f.name === 'quantity')!;
			assert.strictEqual(quantityField.dataType, 'integer');

			const boolField = fields.find(f => f.name === 'is_active')!;
			assert.strictEqual(boolField.dataType, 'boolean');

			const tsField = fields.find(f => f.name === 'created_at')!;
			assert.strictEqual(tsField.dataType, 'timestamp with time zone');

			const tagsField = fields.find(f => f.name === 'tags')!;
			assert.strictEqual(tagsField.dataType, 'text[]');

			const metaField = fields.find(f => f.name === 'metadata')!;
			assert.strictEqual(metaField.dataType, 'jsonb');

			// Fields are leaves.
			assert.strictEqual(idField.getChildren, undefined);

			// Disconnect.
			await conn.disconnect();
		});

		test('view node expands to show fields', async function () {
			this.timeout(10000);

			// Create a table and a view.
			await setupClient.query(`CREATE TABLE "${testSchema}".employees (id serial PRIMARY KEY, name text, salary numeric(12,2))`);
			await setupClient.query(`CREATE VIEW "${testSchema}".employee_list AS SELECT id, name FROM "${testSchema}".employees`);

			// Connect and navigate to the view.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const children = await schemaNode.getChildren!();
			const viewNode = children.find(c => c.name === 'employee_list');
			assert.ok(viewNode);
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);

			// Expand the view to get fields.
			const fields = await viewNode.getChildren!();
			assert.strictEqual(fields.length, 2);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[1].name, 'name');

			// Disconnect.
			await conn.disconnect();
		});

		test('empty schema returns no children', async function () {
			this.timeout(10000);

			// The test schema was created empty -- no tables or views.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);

			// Expand the schema.
			const children = await schemaNode.getChildren!();
			assert.strictEqual(children.length, 0);

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('PostgreSQL-Specific Features', () => {

		test('multiple schemas are independently browsable', async function () {
			this.timeout(10000);

			// Create a second schema.
			const secondSchema = `${testSchema}_extra`;
			await setupClient.query(`CREATE SCHEMA "${secondSchema}"`);

			// Put a table in each schema.
			await setupClient.query(`CREATE TABLE "${testSchema}".alpha (id integer)`);
			await setupClient.query(`CREATE TABLE "${secondSchema}".beta (id integer)`);

			// Connect and browse.
			const conn = await connectDriver();
			const schemas = await conn.getChildren();

			// Find both schemas.
			const schema1 = schemas.find(s => s.name === testSchema);
			const schema2 = schemas.find(s => s.name === secondSchema);
			assert.ok(schema1);
			assert.ok(schema2);

			// Each schema has its own table.
			const children1 = await schema1.getChildren!();
			assert.strictEqual(children1.length, 1);
			assert.strictEqual(children1[0].name, 'alpha');

			const children2 = await schema2.getChildren!();
			assert.strictEqual(children2.length, 1);
			assert.strictEqual(children2[0].name, 'beta');

			// Cleanup the extra schema.
			await setupClient.query(`DROP SCHEMA "${secondSchema}" CASCADE`);

			// Disconnect.
			await conn.disconnect();
		});

		test('enum types are reported by udt_name', async function () {
			this.timeout(10000);

			// Create an enum type and a table that uses it.
			await setupClient.query(`CREATE TYPE "${testSchema}".status_enum AS ENUM ('active', 'inactive', 'pending')`);
			await setupClient.query(`CREATE TABLE "${testSchema}".tasks (id serial PRIMARY KEY, status "${testSchema}".status_enum)`);

			// Connect and navigate to the table.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const children = await schemaNode.getChildren!();
			const tasksNode = children.find(c => c.name === 'tasks')!;
			const fields = await tasksNode.getChildren!();

			// The enum field should report its udt_name.
			const statusField = fields.find(f => f.name === 'status')!;
			assert.strictEqual(statusField.dataType, 'status_enum');

			// Disconnect.
			await conn.disconnect();
		});

		test('array types are reported with bracket notation', async function () {
			this.timeout(10000);

			// Create a table with array columns.
			await setupClient.query(`CREATE TABLE "${testSchema}".arrays (id serial PRIMARY KEY, int_arr integer[], text_arr text[])`);

			// Connect and navigate.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const children = await schemaNode.getChildren!();
			const arrNode = children.find(c => c.name === 'arrays')!;
			const fields = await arrNode.getChildren!();

			// Check array type formatting.
			const intArr = fields.find(f => f.name === 'int_arr')!;
			assert.strictEqual(intArr.dataType, 'int4[]');

			const textArr = fields.find(f => f.name === 'text_arr')!;
			assert.strictEqual(textArr.dataType, 'text[]');

			// Disconnect.
			await conn.disconnect();
		});

		test('tables with many columns are fully enumerated', async function () {
			this.timeout(10000);

			// Create a wide table.
			const columns = Array.from({ length: 50 }, (_, i) => `col_${i} integer`).join(', ');
			await setupClient.query(`CREATE TABLE "${testSchema}".wide_table (${columns})`);

			// Connect and navigate.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const children = await schemaNode.getChildren!();
			const wideNode = children.find(c => c.name === 'wide_table')!;
			const fields = await wideNode.getChildren!();

			// All 50 columns should be present.
			assert.strictEqual(fields.length, 50);
			assert.strictEqual(fields[0].name, 'col_0');
			assert.strictEqual(fields[49].name, 'col_49');

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('Connection Lifecycle', () => {

		test('disconnect then isConnected returns false', async function () {
			this.timeout(10000);

			// Connect.
			const conn = await connectDriver();
			assert.strictEqual(await conn.isConnected(), true);

			// Disconnect.
			await conn.disconnect();

			// Test that the connection is not connected.
			assert.strictEqual(await conn.isConnected(), false);
		});

		test('isReadOnly returns false', async function () {
			this.timeout(10000);

			// Connect.
			const conn = await connectDriver();

			// PostgreSQL driver always returns false for isReadOnly.
			assert.strictEqual(await conn.isReadOnly(), false);

			// Disconnect.
			await conn.disconnect();
		});
	});

	suite('Full Lifecycle', () => {

		test('discover driver -> connect -> browse schema tree -> disconnect', async function () {
			this.timeout(15000);

			// 1. Discover the PostgreSQL driver.
			const drivers = await positron.dataConnections.getDrivers();
			const pg = drivers.find(d => d.id === 'positron-data-driver-postgresql');
			assert.ok(pg, 'PostgreSQL driver should be registered');

			// 2. Create schema objects.
			await setupClient.query(`CREATE TABLE "${testSchema}".employees (id serial PRIMARY KEY, name text NOT NULL, department text, salary numeric(12,2))`);
			await setupClient.query(`CREATE VIEW "${testSchema}".department_count AS SELECT department, COUNT(*) as cnt FROM "${testSchema}".employees GROUP BY department`);

			// 3. Connect through the full stack.
			const conn = await connectDriver();
			assert.strictEqual(await conn.isConnected(), true);

			// 4. Browse: schemas -> test schema -> tables/views -> fields.
			const schemaNode = await findSchemaNode(conn, testSchema);
			assert.strictEqual(schemaNode.kind, positron.DataConnectionNodeKind.Schema);

			const topLevel = await schemaNode.getChildren!();
			assert.strictEqual(topLevel.length, 2);

			// Test employees table.
			const employeesNode = topLevel.find(n => n.name === 'employees')!;
			assert.strictEqual(employeesNode.kind, positron.DataConnectionNodeKind.Table);
			assert.ok(employeesNode.getChildren);

			// Test employees fields.
			const fields = await employeesNode.getChildren!();
			assert.strictEqual(fields.length, 4);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[0].dataType, 'integer');
			assert.strictEqual(fields[1].name, 'name');
			assert.strictEqual(fields[1].dataType, 'text');
			assert.strictEqual(fields[3].name, 'salary');
			assert.strictEqual(fields[3].dataType, 'numeric(12,2)');

			// Test that fields are leaves.
			assert.strictEqual(fields[0].kind, positron.DataConnectionNodeKind.Field);
			assert.strictEqual(fields[0].getChildren, undefined);

			// Test department_count view.
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
