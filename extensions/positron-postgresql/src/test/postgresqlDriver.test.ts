/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { PostgreSQLConnection, PostgreSQLConnectionConfig } from '../postgresqlConnection.js';
import { createSchemaNode } from '../postgresqlNodes.js';

// Default config for tests -- not used to connect, just to construct.
const TEST_CONFIG: PostgreSQLConnectionConfig = {
	host: 'localhost',
	port: 5432,
	database: 'testdb',
	user: 'testuser',
	password: 'testpass',
	ssl: false,
};

// Creates a mock pg Client with configurable query results.
function createMockClient(queryHandler?: (sql: string, params?: any[]) => { rows: any[] }): any {
	const defaultHandler = () => ({ rows: [] });
	const handler = queryHandler || defaultHandler;
	return {
		connect: async () => { },
		query: async (sql: string, params?: any[]) => handler(sql, params),
		end: async () => { },
	};
}

// Injects a mock client into a PostgreSQLConnection, bypassing the real pg Client.
function createTestConnection(mockClient: any): PostgreSQLConnection {
	const conn = new PostgreSQLConnection(TEST_CONFIG);
	(conn as any)._client = mockClient;
	return conn;
}

suite('PostgreSQL Driver Tests', () => {

	// --- Connection lifecycle ---

	test('connect and disconnect', async () => {
		const mock = createMockClient((sql) => {
			if (sql === 'SELECT 1') {
				return { rows: [{ '?column?': 1 }] };
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
		const conn = new PostgreSQLConnection(TEST_CONFIG);
		(conn as any)._client = {
			connect: async () => { throw new Error('Connection refused'); },
		};

		await assert.rejects(
			() => conn.connect(),
			/Failed to connect to PostgreSQL/
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

	// --- Empty database ---

	test('database with no user schemas returns no children', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.schemata')) {
				return { rows: [] };
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const children = await conn.getChildren();
		assert.strictEqual(children.length, 0);

		await conn.disconnect();
	});

	// --- Schema browsing ---

	test('getChildren returns schema nodes', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.schemata')) {
				return {
					rows: [
						{ schema_name: 'public' },
						{ schema_name: 'app' },
					]
				};
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const children = await conn.getChildren();
		assert.strictEqual(children.length, 2);

		const names = children.map(c => c.name).sort();
		assert.deepStrictEqual(names, ['app', 'public']);

		children.forEach(c => {
			assert.strictEqual(c.kind, 'schema');
			assert.ok(c.getChildren, 'schema node should have getChildren');
		});

		await conn.disconnect();
	});

	// --- Tables and views within a schema ---

	test('schema getChildren returns tables and views', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.tables')) {
				return {
					rows: [
						{ table_name: 'users', table_type: 'BASE TABLE' },
						{ table_name: 'orders', table_type: 'BASE TABLE' },
						{ table_name: 'user_orders', table_type: 'VIEW' },
					]
				};
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, 'public');
		assert.ok(schemaNode.getChildren);

		const children = await schemaNode.getChildren!();
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

		// Tables and views should have getChildren and preview.
		children.forEach(c => {
			assert.ok(c.getChildren, `${c.name} should have getChildren`);
			assert.ok(c.preview, `${c.name} should have preview`);
		});
	});

	// --- Field nodes ---

	test('table getChildren returns field nodes with types', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [
						{
							column_name: 'id',
							data_type: 'integer',
							udt_name: 'int4',
							is_nullable: 'NO',
							character_maximum_length: null,
							numeric_precision: 32,
							numeric_scale: 0,
						},
						{
							column_name: 'name',
							data_type: 'character varying',
							udt_name: 'varchar',
							is_nullable: 'YES',
							character_maximum_length: 255,
							numeric_precision: null,
							numeric_scale: null,
						},
						{
							column_name: 'price',
							data_type: 'numeric',
							udt_name: 'numeric',
							is_nullable: 'YES',
							character_maximum_length: null,
							numeric_precision: 10,
							numeric_scale: 2,
						},
						{
							column_name: 'active',
							data_type: 'boolean',
							udt_name: 'bool',
							is_nullable: 'NO',
							character_maximum_length: null,
							numeric_precision: null,
							numeric_scale: null,
						},
					]
				};
			}
			if (sql.includes('information_schema.tables')) {
				return {
					rows: [{ table_name: 'products', table_type: 'BASE TABLE' }]
				};
			}
			return { rows: [] };
		});

		const schemaNode = createSchemaNode(mock, 'public');
		const tables = await schemaNode.getChildren!();
		const productsNode = tables.find(c => c.name === 'products');
		assert.ok(productsNode, 'products table should exist');

		const fields = await productsNode.getChildren!();
		assert.strictEqual(fields.length, 4);

		const idField = fields.find(f => f.name === 'id');
		assert.ok(idField);
		assert.strictEqual(idField.kind, 'field');
		assert.strictEqual(idField.dataType, 'integer');

		const nameField = fields.find(f => f.name === 'name');
		assert.ok(nameField);
		assert.strictEqual(nameField.dataType, 'character varying(255)');

		const priceField = fields.find(f => f.name === 'price');
		assert.ok(priceField);
		assert.strictEqual(priceField.dataType, 'numeric(10,2)');

		const activeField = fields.find(f => f.name === 'active');
		assert.ok(activeField);
		assert.strictEqual(activeField.dataType, 'boolean');

		// Field nodes should be leaves.
		fields.forEach(f => {
			assert.strictEqual(f.getChildren, undefined);
			assert.strictEqual(f.preview, undefined);
		});
	});

	// --- Data type formatting ---

	test('array types formatted correctly', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'tags',
						data_type: 'ARRAY',
						udt_name: '_text',
						is_nullable: 'YES',
						character_maximum_length: null,
						numeric_precision: null,
						numeric_scale: null,
					}]
				};
			}
			if (sql.includes('information_schema.tables')) {
				return { rows: [{ table_name: 't', table_type: 'BASE TABLE' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, 'public');
		const tables = await schema.getChildren!();
		const fields = await tables[0].getChildren!();
		assert.strictEqual(fields[0].dataType, 'text[]');
	});

	test('user-defined types use udt_name', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'status',
						data_type: 'USER-DEFINED',
						udt_name: 'order_status',
						is_nullable: 'YES',
						character_maximum_length: null,
						numeric_precision: null,
						numeric_scale: null,
					}]
				};
			}
			if (sql.includes('information_schema.tables')) {
				return { rows: [{ table_name: 't', table_type: 'BASE TABLE' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, 'public');
		const tables = await schema.getChildren!();
		const fields = await tables[0].getChildren!();
		assert.strictEqual(fields[0].dataType, 'order_status');
	});

	test('numeric without scale omits scale', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('information_schema.columns')) {
				return {
					rows: [{
						column_name: 'amount',
						data_type: 'numeric',
						udt_name: 'numeric',
						is_nullable: 'YES',
						character_maximum_length: null,
						numeric_precision: 18,
						numeric_scale: 0,
					}]
				};
			}
			if (sql.includes('information_schema.tables')) {
				return { rows: [{ table_name: 't', table_type: 'BASE TABLE' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, 'public');
		const tables = await schema.getChildren!();
		const fields = await tables[0].getChildren!();
		assert.strictEqual(fields[0].dataType, 'numeric(18)');
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
			if (sql.includes('information_schema.tables')) {
				return { rows: [{ table_name: 't', table_type: 'BASE TABLE' }] };
			}
			return { rows: [] };
		});

		const schema = createSchemaNode(mock, 'public');
		const tables = await schema.getChildren!();
		assert.ok(tables[0].preview);
		await tables[0].preview!();
	});
});
