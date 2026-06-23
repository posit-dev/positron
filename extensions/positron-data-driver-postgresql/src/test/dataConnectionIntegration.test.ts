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

	// Whether setupClient actually connected. Guards teardown from querying/closing a client that
	// never connected (e.g. when PostgreSQL is unavailable and setup calls this.skip()).
	let setupClientConnected: boolean;

	// Unique schema name per test run to avoid collisions.
	let testSchema: string;

	/**
	 * Setup: connect a raw client, create an isolated schema, and activate the extension.
	 */
	setup(async function () {
		// Allow slow connection.
		this.timeout(10000);

		testSchema = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		setupClientConnected = false;

		setupClient = new Client({
			host: pgHost,
			port: pgPort,
			database: pgDatabase,
			user: pgUser,
			password: pgPassword,
		});

		try {
			await setupClient.connect();
			setupClientConnected = true;
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
		// Only clean up if the client actually connected; otherwise setup skipped the suite and
		// querying/closing the unconnected client would throw.
		if (setupClientConnected) {
			try {
				await setupClient.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
			} finally {
				await setupClient.end();
			}
		}
	});

	// Helper: connect to the test database via the Positron driver.
	async function connectDriver(): Promise<positron.DataConnection> {
		return positron.dataConnections.connect('positron-data-driver-postgresql', 'password', {
			host: pgHost,
			port: pgPort,
			database: pgDatabase,
			user: pgUser,
			password: pgPassword,
			ssl: false,
		});
	}

	// Helper: returns the root Schemas group node.
	async function getSchemasGroup(conn: positron.DataConnection): Promise<positron.DataConnectionNode> {
		const roots = await conn.getChildren();
		assert.strictEqual(roots.length, 1, 'Root should be a single Schemas group');
		assert.strictEqual(roots[0].kind, positron.DataConnectionNodeKind.GroupSchemas);
		return roots[0];
	}

	// Helper: returns the list of schema nodes under the root Schemas group.
	async function listSchemas(conn: positron.DataConnection): Promise<positron.DataConnectionNode[]> {
		const schemasGroup = await getSchemasGroup(conn);
		return schemasGroup.getChildren!();
	}

	// Helper: find a schema node by name under the root Schemas group.
	async function findSchemaNode(conn: positron.DataConnection, name: string): Promise<positron.DataConnectionNode> {
		const schemas = await listSchemas(conn);
		const node = schemas.find(s => s.name === name);
		assert.ok(node, `Schema '${name}' not found`);
		return node;
	}

	// Helper: returns the Tables group node inside a schema.
	async function tablesGroupOf(schemaNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode> {
		const children = await schemaNode.getChildren!();
		const node = children.find(c => c.kind === positron.DataConnectionNodeKind.GroupTables);
		assert.ok(node, 'Schema should have a Tables group');
		return node;
	}

	// Helper: returns the Views group node inside a schema.
	async function viewsGroupOf(schemaNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode> {
		const children = await schemaNode.getChildren!();
		const node = children.find(c => c.kind === positron.DataConnectionNodeKind.GroupViews);
		assert.ok(node, 'Schema should have a Views group');
		return node;
	}

	// Helper: returns the column field nodes for a table or view.
	async function columnsOf(relationNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
		const children = await relationNode.getChildren!();
		const columnsGroup = children.find(c => c.kind === positron.DataConnectionNodeKind.GroupColumns);
		assert.ok(columnsGroup, 'Relation should have a Columns group');
		return columnsGroup.getChildren!();
	}

	// Helper: returns the index nodes for a table.
	async function indexesOf(tableNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
		const children = await tableNode.getChildren!();
		const indexesGroup = children.find(c => c.kind === positron.DataConnectionNodeKind.GroupIndexes);
		assert.ok(indexesGroup, 'Table should have an Indexes group');
		return indexesGroup.getChildren!();
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

		test('PostgreSQL driver has expected mechanisms and parameters', async () => {
			// Get the drivers and find the PostgreSQL driver.
			const drivers = await positron.dataConnections.getDrivers();
			const pg = drivers.find(d => d.id === 'positron-data-driver-postgresql')!;

			// Test the single 'password' mechanism.
			assert.strictEqual(pg.mechanisms.length, 1);
			const mechanism = pg.mechanisms.find(m => m.id === 'password')!;
			assert.ok(mechanism);

			// Test the parameters length.
			assert.strictEqual(mechanism.parameters.length, 6);

			// Check the host parameter.
			const hostParam = mechanism.parameters.find(p => p.id === 'host');
			assert.ok(hostParam);
			assert.strictEqual(hostParam.type, 'string');

			// Check the port parameter.
			const portParam = mechanism.parameters.find(p => p.id === 'port');
			assert.ok(portParam);
			assert.strictEqual(portParam.type, 'number');

			// Check the database parameter.
			const dbParam = mechanism.parameters.find(p => p.id === 'database');
			assert.ok(dbParam);
			assert.strictEqual(dbParam.type, 'string');

			// Check the user parameter.
			const userParam = mechanism.parameters.find(p => p.id === 'user');
			assert.ok(userParam);
			assert.strictEqual(userParam.type, 'string');

			// Check the password parameter.
			const pwParam = mechanism.parameters.find(p => p.id === 'password');
			assert.ok(pwParam);
			assert.strictEqual(pwParam.type, 'password');

			// Check the SSL parameter.
			const sslParam = mechanism.parameters.find(p => p.id === 'ssl');
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

		test('schemas group lists schemas including the test schema', async function () {
			this.timeout(10000);

			// Connect to the test DB.
			const conn = await connectDriver();

			// List schemas via the Schemas group.
			const schemas = await listSchemas(conn);

			// The test schema should be present.
			const testSchemaNode = schemas.find(s => s.name === testSchema);
			assert.ok(testSchemaNode, 'Test schema should appear under the Schemas group');
			assert.strictEqual(testSchemaNode.kind, positron.DataConnectionNodeKind.Schema);

			// System schemas should be excluded.
			const pgCatalog = schemas.find(s => s.name === 'pg_catalog');
			assert.strictEqual(pgCatalog, undefined, 'pg_catalog should be excluded');

			const infoSchema = schemas.find(s => s.name === 'information_schema');
			assert.strictEqual(infoSchema, undefined, 'information_schema should be excluded');

			// Disconnect.
			await conn.disconnect();
		});

		test('schema node expands to Tables and Views groups', async function () {
			this.timeout(10000);

			// Create tables and a view in the test schema.
			await setupClient.query(`CREATE TABLE "${testSchema}".users (id serial PRIMARY KEY, name text, email varchar(255))`);
			await setupClient.query(`CREATE TABLE "${testSchema}".orders (id serial PRIMARY KEY, user_id integer, total numeric(10,2))`);
			await setupClient.query(`CREATE VIEW "${testSchema}".user_orders AS SELECT u.name, o.total FROM "${testSchema}".users u JOIN "${testSchema}".orders o ON u.id = o.user_id`);

			// Connect and find the test schema.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);

			// Check tables.
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const tableNames = tables.map(t => t.name).sort();
			assert.deepStrictEqual(tableNames, ['orders', 'users']);
			assert.ok(tables.every(t => t.kind === positron.DataConnectionNodeKind.Table));

			// Check views.
			const views = await (await viewsGroupOf(schemaNode)).getChildren!();
			assert.strictEqual(views.length, 1);
			assert.strictEqual(views[0].name, 'user_orders');
			assert.strictEqual(views[0].kind, positron.DataConnectionNodeKind.View);

			// Disconnect.
			await conn.disconnect();
		});

		test('table node exposes Columns and Indexes groups; columns carry PostgreSQL types', async function () {
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
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const productsNode = tables.find(c => c.name === 'products');
			assert.ok(productsNode);

			// Columns.
			const fields = await columnsOf(productsNode);
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

			// Indexes: the serial primary key creates an implicit index.
			const indexes = await indexesOf(productsNode);
			assert.ok(indexes.length >= 1, 'Primary key should produce at least one index');
			assert.ok(indexes.every(i => i.kind === positron.DataConnectionNodeKind.Index));
			assert.ok(indexes.every(i => i.getChildren === undefined), 'Indexes are leaves');

			// Disconnect.
			await conn.disconnect();
		});

		test('view node exposes Columns group only (no Indexes)', async function () {
			this.timeout(10000);

			// Create a table and a view.
			await setupClient.query(`CREATE TABLE "${testSchema}".employees (id serial PRIMARY KEY, name text, salary numeric(12,2))`);
			await setupClient.query(`CREATE VIEW "${testSchema}".employee_list AS SELECT id, name FROM "${testSchema}".employees`);

			// Connect and navigate to the view.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const views = await (await viewsGroupOf(schemaNode)).getChildren!();
			const viewNode = views.find(c => c.name === 'employee_list');
			assert.ok(viewNode);
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);

			// Views expose only a Columns group.
			const viewChildren = await viewNode.getChildren!();
			assert.strictEqual(viewChildren.length, 1);
			assert.strictEqual(viewChildren[0].kind, positron.DataConnectionNodeKind.GroupColumns);

			// Columns of the view.
			const fields = await columnsOf(viewNode);
			assert.strictEqual(fields.length, 2);
			assert.strictEqual(fields[0].name, 'id');
			assert.strictEqual(fields[1].name, 'name');

			// Disconnect.
			await conn.disconnect();
		});

		test('empty schema yields empty Tables and Views groups', async function () {
			this.timeout(10000);

			// The test schema was created empty -- no tables or views.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);

			// Tables and Views groups exist; both empty.
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const views = await (await viewsGroupOf(schemaNode)).getChildren!();
			assert.strictEqual(tables.length, 0);
			assert.strictEqual(views.length, 0);

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
			const schemas = await listSchemas(conn);

			// Find both schemas.
			const schema1 = schemas.find(s => s.name === testSchema);
			const schema2 = schemas.find(s => s.name === secondSchema);
			assert.ok(schema1);
			assert.ok(schema2);

			// Each schema has its own table.
			const tables1 = await (await tablesGroupOf(schema1)).getChildren!();
			assert.strictEqual(tables1.length, 1);
			assert.strictEqual(tables1[0].name, 'alpha');

			const tables2 = await (await tablesGroupOf(schema2)).getChildren!();
			assert.strictEqual(tables2.length, 1);
			assert.strictEqual(tables2[0].name, 'beta');

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
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const tasksNode = tables.find(c => c.name === 'tasks')!;
			const fields = await columnsOf(tasksNode);

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
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const arrNode = tables.find(c => c.name === 'arrays')!;
			const fields = await columnsOf(arrNode);

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
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const wideNode = tables.find(c => c.name === 'wide_table')!;
			const fields = await columnsOf(wideNode);

			// All 50 columns should be present.
			assert.strictEqual(fields.length, 50);
			assert.strictEqual(fields[0].name, 'col_0');
			assert.strictEqual(fields[49].name, 'col_49');

			// Disconnect.
			await conn.disconnect();
		});

		test('table indexes are listed under the Indexes group', async function () {
			this.timeout(10000);

			// Create a table with an explicit index in addition to the PK index.
			await setupClient.query(`CREATE TABLE "${testSchema}".accounts (id serial PRIMARY KEY, email text NOT NULL)`);
			await setupClient.query(`CREATE INDEX accounts_email_idx ON "${testSchema}".accounts (email)`);

			// Connect and navigate to the table.
			const conn = await connectDriver();
			const schemaNode = await findSchemaNode(conn, testSchema);
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const accountsNode = tables.find(c => c.name === 'accounts')!;
			const indexes = await indexesOf(accountsNode);

			// The explicit index should be present alongside the PK index.
			const indexNames = indexes.map(i => i.name).sort();
			assert.ok(indexNames.includes('accounts_email_idx'), 'Explicit index should appear');
			assert.ok(indexNames.some(n => n === 'accounts_pkey' || n.endsWith('_pkey')), 'PK index should appear');

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

			// 4. Browse: Schemas group -> test schema -> Tables/Views groups -> Columns groups -> fields.
			const schemaNode = await findSchemaNode(conn, testSchema);
			assert.strictEqual(schemaNode.kind, positron.DataConnectionNodeKind.Schema);

			// Tables.
			const tables = await (await tablesGroupOf(schemaNode)).getChildren!();
			const employeesNode = tables.find(n => n.name === 'employees')!;
			assert.strictEqual(employeesNode.kind, positron.DataConnectionNodeKind.Table);

			// Employees columns.
			const fields = await columnsOf(employeesNode);
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

			// Views.
			const views = await (await viewsGroupOf(schemaNode)).getChildren!();
			const viewNode = views.find(n => n.name === 'department_count')!;
			assert.strictEqual(viewNode.kind, positron.DataConnectionNodeKind.View);
			const viewFields = await columnsOf(viewNode);
			assert.strictEqual(viewFields.length, 2);

			// 5. Disconnect.
			await conn.disconnect();
			assert.strictEqual(await conn.isConnected(), false);
		});
	});
});
