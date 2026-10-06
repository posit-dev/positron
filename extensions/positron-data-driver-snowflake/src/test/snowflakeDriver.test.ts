/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { Readable } from 'stream';
import * as vscode from 'vscode';
import { SnowflakeConnection, SnowflakeConnectionConfig } from '../snowflakeConnection.js';
import { defaultConnectionFactory, isStatementError, SnowflakeConnectionFactory, SnowflakeClient, SnowflakeConnectionOptions } from '../snowflakeClient.js';
import { createDatabaseNode, createSchemaNode, parseSemanticViewDescription, stageFilePath } from '../snowflakeNodes.js';
import { parseSnowflakeAccount } from '../snowflakeDriver.js';
import { isWorkbenchManaged } from '../workbenchCredentials.js';

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
		// Answered from the same handler, cut to the cap the way the real client's streamed read is.
		queryCapped: async (sql: string, limit: number) => {
			const { rows } = handler(sql);
			return { rows: rows.slice(0, limit), total: rows.length };
		},
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

	test('Databases group expands to sorted database nodes via SHOW DATABASES', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW DATABASES')) {
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

	test('database node expands to schema nodes via SHOW SCHEMAS', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW SCHEMAS')) {
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
			if (sql.includes('SHOW TABLES')) {
				return { rows: [{ name: 'USERS' }, { name: 'ORDERS' }] };
			}
			if (sql.includes('SHOW VIEWS')) {
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

	test('Stages group lists stage nodes via SHOW STAGES', async () => {
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
			// Stages hold files, not rows: they expand to their files, but have no preview.
			assert.ok(s.getChildren, `${s.name} should have getChildren`);
			assert.strictEqual(s.preview, undefined);
		});
	});

	test('stage expands to folders and files from LIST, each folder listing its own prefix', async () => {
		const listed: string[] = [];
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'RAW_LOAD', type: 'INTERNAL' }] };
			}
			if (sql.startsWith('LIST ')) {
				listed.push(sql);
				// An internal stage's LIST names each file by the stage's (lowercased) name and its path.
				const files = [
					{ name: 'raw_load/readme.txt', size: 12 },
					{ name: 'raw_load/2024/orders.csv', size: 2048 },
					{ name: 'raw_load/2024/q1/returns.csv', size: 10 },
					{ name: 'raw_load/2024x/other.csv', size: 1 },
				];
				// LIST lists everything under the location it's given.
				const location = /"RAW_LOAD"\/(?<prefix>[^']*)'/.exec(sql)?.groups?.prefix ?? '';
				return { rows: files.filter(file => file.name.startsWith(`raw_load/${location}`)) };
			}
			throw new Error(`Unexpected query: ${sql}`);
		});

		const schemaNode = createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC');
		const [stage] = await stagesOf(schemaNode);
		assert.strictEqual(stage.path, '@"ANALYTICS"."PUBLIC"."RAW_LOAD"');

		const top = await stage.getChildren!();
		assert.deepStrictEqual(top.map(node => [node.kind, node.name, node.dataType, node.path]), [
			[positron.DataConnectionNodeKind.Directory, '2024', undefined, '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/2024/'],
			[positron.DataConnectionNodeKind.Directory, '2024x', undefined, '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/2024x/'],
			[positron.DataConnectionNodeKind.File, 'readme.txt', '12 B', '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/readme.txt'],
		]);

		// The folder lists its own prefix when expanded, so it shows what is there now.
		const inFolder = await top[0].getChildren!();
		assert.deepStrictEqual(inFolder.map(node => [node.kind, node.name, node.dataType, node.path]), [
			[positron.DataConnectionNodeKind.Directory, 'q1', undefined, '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/2024/q1/'],
			[positron.DataConnectionNodeKind.File, 'orders.csv', '2.0 KB', '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/2024/orders.csv'],
		]);
		assert.deepStrictEqual(listed, [
			`LIST '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/'`,
			`LIST '@"ANALYTICS"."PUBLIC"."RAW_LOAD"/2024/'`,
		]);
	});

	test('stageFilePath strips the stage name or URL from a LIST name, however either is spelled', () => {
		assert.deepStrictEqual([
			stageFilePath('raw_load/2024/orders.csv', undefined, 'RAW_LOAD'),
			// A quoted stage name can hold a slash.
			stageFilePath('raw/load/2024/orders.csv', undefined, 'raw/load'),
			stageFilePath('s3://bucket/exports/2024/orders.csv', 's3://bucket/exports/', 'EXPORTS'),
			// The URL SHOW STAGES reports can differ from LIST's names in case and trailing slash.
			stageFilePath('s3://Bucket/Exports/2024/orders.csv', 's3://bucket/exports', 'EXPORTS'),
			stageFilePath('azure://acct.blob.core.windows.net/data/raw/orders.csv', 'azure://acct.blob.core.windows.net/data/', 'EXPORTS'),
			// A folder marker keeps its trailing slash.
			stageFilePath('raw_load/2024/', undefined, 'RAW_LOAD'),
		], ['2024/orders.csv', '2024/orders.csv', '2024/orders.csv', '2024/orders.csv', 'raw/orders.csv', '2024/']);
	});

	test('stage listing says when it was cut short, counting the files below each level', async () => {
		// 10,001 files, all in one folder: more than one listing reads, at the stage and in the folder.
		const many = Array.from({ length: 10001 }, (_, index) => ({ name: `big/sub/f${String(index).padStart(5, '0')}.csv`, size: 1 }));
		const listed: string[] = [];
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'BIG' }] };
			}
			listed.push(sql);
			// LIST lists everything under the location it's given.
			const location = /"BIG"\/(?<prefix>[^']*)'/.exec(sql)?.groups?.prefix ?? '';
			return { rows: many.filter(file => file.name.startsWith(`big/${location}`)) };
		});

		const [big] = await stagesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		const atStage = await big.getChildren!();
		const inFolder = await atStage[1].getChildren!();
		assert.deepStrictEqual({
			atStage: atStage.map(node => [node.kind, node.name]),
			inFolder: [inFolder.length, inFolder[0].kind, inFolder[0].name],
			listed,
		}, {
			atStage: [
				[positron.DataConnectionNodeKind.Notice, 'Only the first 10,000 of the 10,001 files in this stage were listed'],
				[positron.DataConnectionNodeKind.Directory, 'sub'],
			],
			inFolder: [10001, positron.DataConnectionNodeKind.Notice, 'Only the first 10,000 of the 10,001 files in this folder and its subfolders were listed'],
			listed: [`LIST '@"ANALYTICS"."PUBLIC"."BIG"/'`, `LIST '@"ANALYTICS"."PUBLIC"."BIG"/sub/'`],
		});
	});

	test('stage listing says why it is empty when the role can\'t list it, and fails when the connection does', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'GONE' }, { name: 'LOCKED' }] };
			}
			if (sql.includes('"LOCKED"')) {
				// Snowflake reports a statement's own failure with a SQL state.
				throw Object.assign(new Error('Insufficient privileges to operate on stage'), { sqlState: '42501' });
			}
			throw new Error('Snowflake client is closed');
		});

		const [gone, locked] = await stagesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		assert.deepStrictEqual((await locked.getChildren!()).map(node => [node.kind, node.name]), [
			[positron.DataConnectionNodeKind.Notice, 'Could not list the files: Insufficient privileges to operate on stage'],
		]);
		// A connection problem is the tree's to report, not the stage's.
		await assert.rejects(async () => gone.getChildren!(), /Snowflake client is closed/);
	});

	test('stage details show its SHOW row and its DESCRIBE STAGE properties, grouped', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'EXPORTS', type: 'EXTERNAL', url: '["s3://bucket/exports/"]', cloud: 'AWS', directory_enabled: 'N', owner: 'SYSADMIN', comment: '' }] };
			}
			if (sql.startsWith('DESCRIBE STAGE')) {
				return {
					rows: [
						{ parent_property: 'STAGE_FILE_FORMAT', property: 'TYPE', property_value: 'CSV', property_default: 'CSV' },
						{ parent_property: 'STAGE_COPY_OPTIONS', property: 'ON_ERROR', property_value: 'ABORT_STATEMENT', property_default: 'ABORT_STATEMENT' },
					]
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		});

		const [stage] = await stagesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		const details = await stage.getDetails!();
		assert.deepStrictEqual(details.description, 'External stage');
		assert.deepStrictEqual(details.tabs, [
			{
				title: 'Overview', sections: [{
					kind: 'properties', properties: [
						{ name: 'Path', value: '@"ANALYTICS"."PUBLIC"."EXPORTS"' },
						{ name: 'Type', value: 'EXTERNAL' },
						// The URL's list form is unwrapped.
						{ name: 'URL', value: 's3://bucket/exports/' },
						{ name: 'Cloud', value: 'AWS' },
						{ name: 'Directory Table', value: 'No' },
						{ name: 'Owner', value: 'SYSADMIN' },
					]
				}]
			},
			{
				title: 'Properties', sections: [
					{ kind: 'table', title: 'File Format', columns: ['Property', 'Value', 'Default'], rows: [['TYPE', 'CSV', 'CSV']] },
					{ kind: 'table', title: 'Copy Options', columns: ['Property', 'Value', 'Default'], rows: [['ON_ERROR', 'ABORT_STATEMENT', 'ABORT_STATEMENT']] },
				]
			},
		]);
	});

	test('a stage file\'s details show its LIST row, its modification time in the local format', async () => {
		const modified = 'Thu, 3 Oct 2024 16:09:00 GMT';
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'RAW' }] };
			}
			return { rows: [{ name: 'raw/model.yaml', size: 7066, md5: '5648cc8f8d7c35fda4ca7f310ff2db67', last_modified: modified }] };
		});

		const [stage] = await stagesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		const [file] = await stage.getChildren!();
		assert.deepStrictEqual(await file.getDetails!(), {
			description: 'File',
			sections: [{
				kind: 'properties', properties: [
					{ name: 'Path', value: '@"ANALYTICS"."PUBLIC"."RAW"/model.yaml' },
					{ name: 'Size', value: '6.9 KB' },
					// LIST reports the time as text; it is shown like every other date in the details.
					{ name: 'Last Modified', value: new Date(modified).toLocaleString() },
					{ name: 'MD5', value: '5648cc8f8d7c35fda4ca7f310ff2db67' },
				]
			}],
		});
	});

	test('stage folder markers add their folders but no file', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW STAGES')) {
				return { rows: [{ name: 'RAW' }] };
			}
			return { rows: [{ name: 'raw/empty/', size: 0 }, { name: 'raw/a.csv', size: 1 }] };
		});

		const [stage] = await stagesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		assert.deepStrictEqual((await stage.getChildren!()).map(node => [node.kind, node.name]), [
			[positron.DataConnectionNodeKind.Directory, 'empty'],
			[positron.DataConnectionNodeKind.File, 'a.csv'],
		]);
	});

	// --- Details for databases, schemas, tables, and views ---

	test('database and schema details show their SHOW rows, leaving out empty values', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW DATABASES')) {
				return { rows: [{ name: 'ANALYTICS', kind: 'STANDARD', owner: 'SYSADMIN', origin: '', retention_time: '1', comment: null }] };
			}
			if (sql.includes('SHOW SCHEMAS')) {
				return { rows: [{ name: 'PUBLIC', owner: 'SYSADMIN', options: 'MANAGED ACCESS', retention_time: '1', comment: 'Main' }] };
			}
			return { rows: [] };
		});

		const [database] = await databasesOf(createTestConnection(mock));
		const [schema] = await schemasOf(database);
		assert.deepStrictEqual([database.path, await database.getDetails!(), schema.path, await schema.getDetails!()], [
			'"ANALYTICS"',
			{
				description: 'Database', sections: [{
					kind: 'properties', properties: [
						{ name: 'Path', value: '"ANALYTICS"' },
						{ name: 'Kind', value: 'STANDARD' },
						{ name: 'Owner', value: 'SYSADMIN' },
						{ name: 'Retention Time (Days)', value: '1' },
					]
				}]
			},
			'"ANALYTICS"."PUBLIC"',
			{
				description: 'Schema', sections: [{
					kind: 'properties', properties: [
						{ name: 'Path', value: '"ANALYTICS"."PUBLIC"' },
						{ name: 'Owner', value: 'SYSADMIN' },
						{ name: 'Options', value: 'MANAGED ACCESS' },
						{ name: 'Retention Time (Days)', value: '1' },
						{ name: 'Comment', value: 'Main' },
					]
				}]
			},
		]);
	});

	test('table details show its SHOW row and its columns, naming a special kind of table', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW TABLES')) {
				return {
					rows: [{
						name: 'ORDERS', kind: 'TABLE', owner: 'SYSADMIN', rows: 1234567, bytes: 1536, cluster_by: 'LINEAR(D)',
						automatic_clustering: 'ON', change_tracking: 'OFF', retention_time: '1', is_dynamic: 'Y', comment: 'Orders',
					}]
				};
			}
			if (sql.startsWith('DESCRIBE TABLE')) {
				return { rows: [{ name: 'ID', type: 'NUMBER(38,0)', comment: 'the id' }] };
			}
			throw new Error(`Unexpected query: ${sql}`);
		});

		const [table] = await tablesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		assert.deepStrictEqual(await table.getDetails!(), {
			description: 'Dynamic table',
			sections: [],
			tabs: [
				{
					title: 'Overview', sections: [{
						kind: 'properties', properties: [
							{ name: 'Path', value: '"ANALYTICS"."PUBLIC"."ORDERS"' },
							{ name: 'Kind', value: 'TABLE' },
							{ name: 'Owner', value: 'SYSADMIN' },
							{ name: 'Rows', value: (1234567).toLocaleString() },
							{ name: 'Size', value: '1.5 KB' },
							{ name: 'Clustering Key', value: 'LINEAR(D)' },
							{ name: 'Automatic Clustering', value: 'Yes' },
							{ name: 'Change Tracking', value: 'No' },
							{ name: 'Retention Time (Days)', value: '1' },
							{ name: 'Comment', value: 'Orders' },
						]
					}]
				},
				{
					title: 'Columns', sections: [{
						kind: 'items',
						items: [{ name: 'ID', kind: positron.DataConnectionNodeKind.Field, dataType: 'NUMBER(38,0)', description: 'the id' }],
						emptyText: 'No columns',
					}]
				},
			],
		});
	});

	test('view details show its definition, or say it is unavailable for a secure view', async () => {
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW VIEWS')) {
				return {
					rows: [
						{ name: 'OPEN_V', is_secure: 'false', is_materialized: 'true', text: 'create view OPEN_V as select 1' },
						{ name: 'SECURE_V', is_secure: 'true', is_materialized: 'false', text: '' },
					]
				};
			}
			if (sql.startsWith('DESCRIBE VIEW')) {
				return { rows: [] };
			}
			throw new Error(`Unexpected query: ${sql}`);
		});

		const views = await viewsOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		const details = await Promise.all(views.map(view => view.getDetails!()));
		assert.deepStrictEqual(details.map(detail => [detail.description, detail.tabs![2].sections]), [
			['Materialized view', [{ kind: 'code', languageId: 'sql', code: 'create view OPEN_V as select 1' }]],
			['View', [{ kind: 'properties', properties: [{ name: 'Unavailable', value: 'The definition is not available to the current role.' }] }]],
		]);
	});

	test('a table\'s details share one DESCRIBE across clicks until the table is refreshed', async () => {
		let describes = 0;
		const mock = createMockClient((sql) => {
			if (sql.includes('SHOW TABLES')) {
				return { rows: [{ name: 'ORDERS' }] };
			}
			if (sql.startsWith('DESCRIBE TABLE')) {
				describes++;
				return { rows: [{ name: 'ID', type: 'NUMBER(38,0)' }] };
			}
			throw new Error(`Unexpected query: ${sql}`);
		});

		const [table] = await tablesOf(createSchemaNode(mock, noopHost, 'ANALYTICS', 'PUBLIC'));
		await table.getDetails!();
		await table.getDetails!();
		const afterClicks = describes;
		// Refreshing the table re-runs its getChildren, which drops the shared DESCRIBE.
		await table.getChildren!();
		await table.getDetails!();
		assert.deepStrictEqual([afterClicks, describes], [1, 2]);
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
			if (sql.includes('SHOW TABLES')) {
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
			if (sql.includes('SHOW TABLES')) {
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
			if (sql.includes('SHOW TABLES')) {
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

	test('fetches the token from the provider on every connect and reconnect', async () => {
		// A Workbench-managed token is rotated externally, so each connection the client builds must
		// carry the token current at that moment rather than the one captured at construction.
		const tokens = ['token-1', 'token-2'];
		const seenTokens: Array<string | undefined> = [];
		const seenProviders: Array<unknown> = [];
		const { factory: inner, connections } = makeFactory([
			() => { throw new Error('Connection terminated unexpectedly'); },
			() => ({ rows: [{ ok: true }] }),
		]);
		const factory: SnowflakeConnectionFactory = async options => {
			seenTokens.push(options.token);
			seenProviders.push(options.tokenProvider);
			return inner(options);
		};
		const client = new SnowflakeClient({
			...OPTIONS,
			authenticator: 'OAUTH',
			tokenProvider: async () => tokens.shift()!,
		}, factory);

		await client.connect();
		await client.query('SELECT 1');

		assert.strictEqual(connections.length, 2);
		assert.deepStrictEqual(seenTokens, ['token-1', 'token-2']);
		assert.deepStrictEqual(seenProviders, [undefined, undefined], 'the provider itself must not reach the SDK options');
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

suite('Snowflake Capped Query', () => {

	const OPTIONS: SnowflakeConnectionOptions = {
		account: 'myorg-myacct',
		username: 'testuser',
		password: 'testpass',
	};

	// How a fake connection answers a streamed statement: the rows of its result, or the failure it
	// reports instead -- as the statement runs, as its result is read, or as its stream fails.
	interface IStreamedAnswer {
		rows?: Record<string, unknown>[];
		executeError?: Error;
		readThrows?: Error;
		streamError?: Error;
	}

	// A fake sdk connection that answers a streamed statement the way snowflake-sdk does: `complete`
	// gets the statement but no rows, which are read from it with getNumRows and an inclusive
	// streamRows range. Records each range read.
	function streamingConnection(answer: IStreamedAnswer) {
		const ranges: { start: number; end: number }[] = [];
		const conn = {
			connect: (cb: (err: unknown, conn: unknown) => void) => cb(undefined, conn),
			destroy: (cb: (err: unknown, conn: unknown) => void) => cb(undefined, conn),
			execute: (opts: { streamResult?: boolean; complete: (err: unknown, stmt: unknown, rows: unknown) => void }) => {
				assert.strictEqual(opts.streamResult, true, 'a capped query streams its result');
				if (answer.executeError) {
					opts.complete(answer.executeError, undefined, undefined);
					return;
				}
				const rows = answer.rows ?? [];
				opts.complete(undefined, {
					getNumRows: () => {
						if (answer.readThrows) {
							throw answer.readThrows;
						}
						return rows.length;
					},
					streamRows: (range: { start: number; end: number }) => {
						ranges.push(range);
						const streamError = answer.streamError;
						return streamError
							? new Readable({ objectMode: true, read() { this.destroy(streamError); } })
							: Readable.from(rows.slice(range.start, range.end + 1));
					},
				}, undefined);
			},
		};
		return { conn, ranges };
	}

	// Builds a client over the given fake connections, the nth backing the nth connection built.
	function clientOver(...conns: unknown[]): { client: SnowflakeClient; built: () => number } {
		let n = 0;
		// eslint-disable-next-line local/code-no-any-casts
		const factory: SnowflakeConnectionFactory = async () => conns[n++] as any;
		return { client: new SnowflakeClient(OPTIONS, factory), built: () => n };
	}

	test('reads only the first rows of a result, and says how many it had', async () => {
		const { conn, ranges } = streamingConnection({ rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }] });
		const { client } = clientOver(conn);
		await client.connect();

		const result = await client.queryCapped('LIST @s', 3);

		assert.deepStrictEqual([result, ranges], [{ rows: [{ n: 1 }, { n: 2 }, { n: 3 }], total: 5 }, [{ start: 0, end: 2 }]]);
	});

	test('reads nothing from an empty result', async () => {
		const { conn, ranges } = streamingConnection({ rows: [] });
		const { client } = clientOver(conn);
		await client.connect();

		const result = await client.queryCapped('LIST @s', 3);

		assert.deepStrictEqual([result, ranges], [{ rows: [], total: 0 }, []]);
	});

	test('rejects when reading the result throws, or its stream fails', async () => {
		const reading = clientOver(streamingConnection({ rows: [{ n: 1 }], readThrows: new Error('cannot read the result') }).conn).client;
		const streaming = clientOver(streamingConnection({ rows: [{ n: 1 }], streamError: new Error('the stream broke') }).conn).client;
		await reading.connect();
		await streaming.connect();

		await assert.rejects(reading.queryCapped('LIST @s', 3), /cannot read the result/);
		await assert.rejects(streaming.queryCapped('LIST @s', 3), /the stream broke/);
	});

	test('reconnects once and retries when the session is dead', async () => {
		const { client, built } = clientOver(
			streamingConnection({ executeError: new Error('Connection terminated unexpectedly') }).conn,
			streamingConnection({ rows: [{ n: 1 }] }).conn,
		);
		await client.connect();

		const result = await client.queryCapped('LIST @s', 3);

		assert.deepStrictEqual([result, built()], [{ rows: [{ n: 1 }], total: 1 }, 2]);
	});

	test('tells a statement\'s own failure from a connection\'s', () => {
		assert.deepStrictEqual([
			isStatementError(Object.assign(new Error('Insufficient privileges'), { sqlState: '42501' })),
			isStatementError(Object.assign(new Error('Connection does not exist'), { sqlState: '08003' })),
			isStatementError(new Error('Snowflake client is closed')),
			isStatementError(Object.assign(new Error('Network error'), { sqlState: '42501' })),
		], [true, false, false, false]);
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

suite('Workbench Managed Credentials Detection', () => {
	// The helper is shared verbatim with the Databricks driver (a vitest guard keeps the copies
	// identical), so these cases cover both.
	const workbenchEnv = { RS_SERVER_URL: 'https://workbench.example.com/', SNOWFLAKE_HOME: '/home/u/.local/share/posit-workbench/snowflake' };

	test('requires a Workbench web session and a Workbench-managed credential path', () => {
		assert.deepStrictEqual({
			workbench: isWorkbenchManaged('SNOWFLAKE_HOME', workbenchEnv, vscode.UIKind.Web),
			desktop: isWorkbenchManaged('SNOWFLAKE_HOME', workbenchEnv, vscode.UIKind.Desktop),
			notWorkbench: isWorkbenchManaged('SNOWFLAKE_HOME', { SNOWFLAKE_HOME: workbenchEnv.SNOWFLAKE_HOME }, vscode.UIKind.Web),
			userHome: isWorkbenchManaged('SNOWFLAKE_HOME', { ...workbenchEnv, SNOWFLAKE_HOME: '/home/u/.snowflake' }, vscode.UIKind.Web),
			unset: isWorkbenchManaged('DATABRICKS_CONFIG_FILE', workbenchEnv, vscode.UIKind.Web),
		}, {
			workbench: true,
			desktop: false,
			notWorkbench: false,
			userHome: false,
			unset: false,
		});
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
function createSemanticViewClient(ddlError?: string, queries: { sql: string; binds?: any[] }[] = [], ddl = 'create or replace semantic view CHAOS_MODEL'): any {
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
			return { rows: [{ DDL: ddl }] };
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

	test('each Overview heading names the tree node it stands for', async () => {
		const semanticView = await semanticViewOf(createSemanticViewClient());
		const details = await semanticView.getDetails!();

		// Headings and their tree paths, walking Logical Tables > REF_ENTITIES > its member groups.
		type Group = Extract<positron.DataConnectionNodeDetailsSection, { kind: 'group' }>;
		const groups = details.tabs![0].sections.filter((section): section is Group => section.kind === 'group');
		const [logicalTables] = groups;
		const refEntities = logicalTables.sections[0] as Group;
		const dimensions = refEntities.sections.find((section): section is Group => section.kind === 'group' && section.title === 'Dimensions')!;
		const path = (group: Group) => group.treePath!.map(node => `${node.kind}:${node.name}`).join(' > ');

		assert.deepStrictEqual(
			[...groups, refEntities, dimensions].map(path),
			[
				'group-logical-tables:Logical Tables',
				'group-derived-metrics:Derived Metrics',
				'group-relationships:Relationships',
				'group-logical-tables:Logical Tables > logical-table:REF_ENTITIES',
				'group-logical-tables:Logical Tables > logical-table:REF_ENTITIES > group-dimensions:Dimensions',
			]);
	});

	test('a semantic view\'s Definition is unavailable, not blank, when GET_DDL returns nothing', async () => {
		// What a role that can see the semantic view but not read its definition gets back.
		const semanticView = await semanticViewOf(createSemanticViewClient(undefined, [], ''));
		const details = await semanticView.getDetails!();

		assert.deepStrictEqual(
			details.tabs!.find(tab => tab.title === 'Definition')!.sections,
			[{ kind: 'properties', properties: [{ name: 'Unavailable', value: 'The definition is not available to the current role.' }] }]);
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
