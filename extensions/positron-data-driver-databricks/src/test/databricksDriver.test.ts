/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { DatabricksConnection, DatabricksConnectionConfig } from '../databricksConnection.js';
import {
	connectionOptions,
	DatabricksClient,
	DatabricksSdkClientFactory,
	IDatabricksOperation,
	IDatabricksSdkClient,
	IDatabricksSession,
} from '../databricksClient.js';
import { createCatalogNode, createSchemaNode, formatFileSize } from '../databricksNodes.js';
import { databricksDisplayType, parseDescribeRows } from '../databricksSql.js';
import { generateConnectionCode, parseDatabricksHost, parseDatabricksHttpPath, validateRequired } from '../databricksDriver.js';

// Default config for tests -- not used to connect, just to construct.
const TEST_CONFIG: DatabricksConnectionConfig = {
	host: 'dbc-a1b2c3d4.cloud.databricks.com',
	httpPath: '/sql/1.0/warehouses/abc123',
	authType: 'pat',
	token: 'dapi-test-token',
};

// A no-op Data Explorer host: these tests exercise schema browsing, not previewing, and a real
// handler would register a Data Explorer provider that collides with the activated extension's. One
// object satisfies both the connection's host interface and the node-builder's preview-host interface.
const noopHost = {
	previewObject: async () => 'noop-dataset',
	previewColumn: async () => 'noop-dataset',
	openTableView: async () => { },
	openColumnView: async () => { },
	closeTableView: () => { },
};

// Creates a mock DatabricksClient with configurable query results. `relations` answers the metadata
// listing the Tables and Views groups use, in the JDBC getTables shape.
function createMockClient(queryHandler?: (sql: string) => { rows: any[] }, relations: any[] = []): any {
	const defaultHandler = () => ({ rows: [] });
	const handler = queryHandler || defaultHandler;
	return {
		connect: async () => { },
		query: async (sql: string) => handler(sql),
		listTables: async () => ({ rows: relations }),
		end: async () => { },
	};
}

// A row in the JDBC getTables shape, as the metadata API returns it.
function relationRow(schema: string, name: string, type: string): Record<string, unknown> {
	return { TABLE_CAT: 'main', TABLE_SCHEM: schema, TABLE_NAME: name, TABLE_TYPE: type };
}

// Injects a mock client into a DatabricksConnection, bypassing the real SDK client.
function createTestConnection(mockClient: any): DatabricksConnection {
	const conn = new DatabricksConnection(TEST_CONFIG, noopHost);
	// eslint-disable-next-line local/code-no-any-casts
	(conn as any)._client = mockClient;
	return conn;
}

// Expands the connection's single Catalogs group to its catalog nodes.
async function catalogsOf(conn: DatabricksConnection): Promise<positron.DataConnectionNode[]> {
	const [catalogsGroup] = await conn.getChildren();
	return catalogsGroup.getChildren!();
}

// Expands a catalog node to its Schemas group children (schema nodes).
async function schemasOf(catalogNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const [schemasGroup] = await catalogNode.getChildren!();
	return schemasGroup.getChildren!();
}

// Expands a schema node to the children of the group of the given kind.
async function groupChildren(schemaNode: positron.DataConnectionNode, kind: positron.DataConnectionNodeKind): Promise<positron.DataConnectionNode[]> {
	const groups = await schemaNode.getChildren!();
	return groups.find(g => g.kind === kind)!.getChildren!();
}

// Expands a table or view node to its Columns group children (field nodes).
async function columnsOf(relationNode: positron.DataConnectionNode): Promise<positron.DataConnectionNode[]> {
	const groups = await relationNode.getChildren!();
	const columnsGroup = groups.find(g => g.kind === positron.DataConnectionNodeKind.GroupColumns)!;
	return columnsGroup.getChildren!();
}

suite('Databricks Driver Tests', () => {

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
		const conn = createTestConnection(createMockClient());

		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect failure throws', async () => {
		const conn = new DatabricksConnection(TEST_CONFIG, noopHost);
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = {
			connect: async () => { throw new Error('Invalid access token'); },
		};

		await assert.rejects(
			() => conn.connect(),
			/Failed to connect to Databricks workspace/
		);
		// After failed connect, isConnected should return false.
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('connect on already-disconnected connection throws', async () => {
		const conn = createTestConnection(createMockClient());
		await conn.disconnect();

		await assert.rejects(
			() => conn.connect(),
			/disconnected/
		);
	});

	test('isReadOnly returns false', async () => {
		const conn = createTestConnection(createMockClient());
		assert.strictEqual(await conn.isReadOnly(), false);
		await conn.disconnect();
	});

	// --- Schema browsing ---

	test('getChildren returns a single Catalogs group node', async () => {
		const conn = createTestConnection(createMockClient());
		const children = await conn.getChildren();

		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].name, 'Catalogs');
		assert.strictEqual(children[0].kind, positron.DataConnectionNodeKind.GroupCatalogs);
		await conn.disconnect();
	});

	test('Catalogs group expands to sorted catalog nodes via SHOW CATALOGS', async () => {
		const mock = createMockClient((sql) => {
			if (/SHOW CATALOGS/.test(sql)) {
				return { rows: [{ catalog: 'samples' }, { catalog: 'hive_metastore' }, { catalog: 'main' }] };
			}
			return { rows: [] };
		});
		const conn = createTestConnection(mock);

		const catalogs = await catalogsOf(conn);
		assert.deepStrictEqual(catalogs.map(c => c.name), ['hive_metastore', 'main', 'samples']);
		assert.deepStrictEqual(catalogs.map(c => c.kind), Array(3).fill(positron.DataConnectionNodeKind.Catalog));
		await conn.disconnect();
	});

	test('catalog node expands to schema nodes via SHOW SCHEMAS', async () => {
		const mock = createMockClient((sql) => {
			if (/SHOW SCHEMAS IN `main`/.test(sql)) {
				return { rows: [{ databaseName: 'sales' }, { databaseName: 'default' }] };
			}
			return { rows: [] };
		});
		const catalogNode = createCatalogNode(mock, noopHost, 'main');

		const schemas = await schemasOf(catalogNode);
		assert.deepStrictEqual(schemas.map(s => s.name), ['default', 'sales']);
		assert.deepStrictEqual(schemas.map(s => s.kind), [positron.DataConnectionNodeKind.Schema, positron.DataConnectionNodeKind.Schema]);
	});

	test('SHOW SCHEMAS is read through its column aliases across versions', async () => {
		// Open-source Spark reports the schema name as `namespace` rather than `databaseName`; the
		// tree must still show names rather than a row of "undefined".
		const mock = createMockClient((sql) => {
			if (/SHOW SCHEMAS/.test(sql)) {
				return { rows: [{ namespace: 'bronze' }, { namespace: 'silver' }] };
			}
			return { rows: [] };
		});

		const schemas = await schemasOf(createCatalogNode(mock, noopHost, 'main'));
		assert.deepStrictEqual(schemas.map(s => s.name), ['bronze', 'silver']);
	});

	test('schema getChildren returns Tables, Views, and Volumes groups', async () => {
		const schemaNode = createSchemaNode(createMockClient(), noopHost, 'main', 'sales');
		const groups = await schemaNode.getChildren!();

		assert.deepStrictEqual(groups.map(g => g.name), ['Tables', 'Views', 'Volumes']);
		assert.deepStrictEqual(groups.map(g => g.kind), [
			positron.DataConnectionNodeKind.GroupTables,
			positron.DataConnectionNodeKind.GroupViews,
			positron.DataConnectionNodeKind.GroupVolumes,
		]);
	});

	test('relations are split into Tables and Views by their reported type', async () => {
		const mock = createMockClient(undefined, [
			relationRow('sales', 'orders', 'TABLE'),
			relationRow('sales', 'orders_summary', 'VIEW'),
			relationRow('sales', 'customers', 'MANAGED'),
			relationRow('sales', 'daily_totals', 'MATERIALIZED VIEW'),
			relationRow('sales', 'events', 'STREAMING_TABLE'),
		]);
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');

		const tables = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);
		const views = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupViews);
		// Managed and streaming tables are tables; anything the server calls a view is a view.
		assert.deepStrictEqual(tables.map(t => t.name), ['customers', 'events', 'orders']);
		assert.deepStrictEqual(tables.map(t => t.kind), Array(3).fill(positron.DataConnectionNodeKind.Table));
		assert.deepStrictEqual(views.map(v => v.name), ['daily_totals', 'orders_summary']);
		assert.deepStrictEqual(views.map(v => v.kind), Array(2).fill(positron.DataConnectionNodeKind.View));
	});

	test('a schema-pattern over-match from another schema is filtered out', async () => {
		// The metadata API treats the schema as a LIKE pattern, where '_' matches any character, so
		// listing `raw_data` can also return rows from `raw2data`.
		const mock = createMockClient(undefined, [
			relationRow('raw_data', 'orders', 'TABLE'),
			relationRow('raw2data', 'not_ours', 'TABLE'),
			// A server that reports no schema is kept: it cannot be an over-match, and dropping it
			// would empty the group.
			{ TABLE_NAME: 'unqualified', TABLE_TYPE: 'TABLE' },
		]);
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'raw_data');

		const tables = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);
		assert.deepStrictEqual(tables.map(t => t.name), ['orders', 'unqualified']);
	});

	test('relations with no reported type all land under Tables', async () => {
		const mock = createMockClient(undefined, [{ TABLE_SCHEM: 'sales', TABLE_NAME: 'orders' }]);
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');

		const tables = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);
		const views = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupViews);
		// Better to show an untyped relation as a table than to have it vanish from both groups.
		assert.deepStrictEqual(tables.map(t => t.name), ['orders']);
		assert.deepStrictEqual(views.map(v => v.name), []);
	});

	test('table Columns group returns field nodes with types', async () => {
		const mock = createMockClient((sql) => {
			if (/DESCRIBE TABLE `main`.`sales`.`orders`/.test(sql)) {
				return {
					rows: [
						{ col_name: 'id', data_type: 'bigint', comment: null },
						{ col_name: 'total', data_type: 'decimal(10,2)', comment: null },
						{ col_name: 'placed_at', data_type: 'timestamp', comment: null },
					],
				};
			}
			return { rows: [] };
		}, [relationRow('sales', 'orders', 'TABLE')]);
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');
		const [orders] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);

		const columns = await columnsOf(orders);
		assert.deepStrictEqual(
			columns.map(c => ({ name: c.name, dataType: c.dataType, kind: c.kind, isPrimaryKey: c.isPrimaryKey })),
			[
				{ name: 'id', dataType: 'bigint', kind: positron.DataConnectionNodeKind.Field, isPrimaryKey: false },
				{ name: 'total', dataType: 'decimal(10,2)', kind: positron.DataConnectionNodeKind.Field, isPrimaryKey: false },
				{ name: 'placed_at', dataType: 'timestamp', kind: positron.DataConnectionNodeKind.Field, isPrimaryKey: false },
			]);
	});

	test('table getChildren returns only a Columns group', async () => {
		const mock = createMockClient(undefined, [relationRow('sales', 'orders', 'TABLE')]);
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');
		const [orders] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);

		const groups = await orders.getChildren!();
		assert.deepStrictEqual(groups.map(g => g.name), ['Columns']);
	});

	// --- Volumes ---

	test('Volumes group lists the schema volumes from information_schema', async () => {
		const mock = createMockClient((sql) => {
			if (/information_schema\.volumes/.test(sql)) {
				// The lookup is a three-part table reference, which is allowed across catalogs.
				assert.match(sql, /FROM `main`\.information_schema\.volumes WHERE volume_schema = 'sales'/);
				return { rows: [{ volume_name: 'raw_files' }, { volume_name: 'images' }] };
			}
			return { rows: [] };
		});
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');

		const volumes = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupVolumes);
		assert.deepStrictEqual(volumes.map(v => v.name), ['images', 'raw_files']);
		assert.deepStrictEqual(volumes.map(v => v.kind), Array(2).fill(positron.DataConnectionNodeKind.Volume));
	});

	test('a catalog with no information_schema reports no volumes rather than an error', async () => {
		// hive_metastore has no information_schema, and no volumes either -- volumes are a Unity Catalog
		// concept -- so an empty group is the correct answer.
		const mock = createMockClient((sql) => {
			if (/information_schema\.volumes/.test(sql)) {
				throw new Error('[TABLE_OR_VIEW_NOT_FOUND] The table or view `hive_metastore`.`information_schema`.`volumes` cannot be found');
			}
			return { rows: [] };
		});
		const schemaNode = createSchemaNode(mock, noopHost, 'hive_metastore', 'default');

		const volumes = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupVolumes);
		assert.deepStrictEqual(volumes, []);
	});

	test('a volume expands to its files and directories, directories first', async () => {
		const mock = createMockClient((sql) => {
			if (/information_schema\.volumes/.test(sql)) {
				return { rows: [{ volume_name: 'raw_files' }] };
			}
			if (/^LIST '\/Volumes\/main\/sales\/raw_files'$/.test(sql)) {
				return {
					rows: [
						{ path: 'dbfs:/Volumes/main/sales/raw_files/orders.parquet', name: 'orders.parquet', size: 2048 },
						{ path: 'dbfs:/Volumes/main/sales/raw_files/archive/', name: 'archive/', size: 0 },
						{ path: 'dbfs:/Volumes/main/sales/raw_files/logo.png', name: 'logo.png', size: 512 },
					],
				};
			}
			return { rows: [] };
		});
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');
		const [volume] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupVolumes);

		const contents = await volume.getChildren!();
		assert.deepStrictEqual(
			contents.map(node => ({ name: node.name, kind: node.kind, dataType: node.dataType })),
			[
				{ name: 'archive', kind: positron.DataConnectionNodeKind.Directory, dataType: undefined },
				{ name: 'logo.png', kind: positron.DataConnectionNodeKind.File, dataType: '512 B' },
				{ name: 'orders.parquet', kind: positron.DataConnectionNodeKind.File, dataType: '2.0 KB' },
			]);
	});

	test('a directory inside a volume expands against its own path', async () => {
		const listed: string[] = [];
		const mock = createMockClient((sql) => {
			if (/information_schema\.volumes/.test(sql)) {
				return { rows: [{ volume_name: 'raw_files' }] };
			}
			if (/^LIST /.test(sql)) {
				listed.push(sql);
				// The volume root holds one directory; the directory itself holds one file.
				return sql.includes('/archive')
					? { rows: [{ name: 'old.csv', size: 10 }] }
					: { rows: [{ name: 'archive/', size: 0 }] };
			}
			return { rows: [] };
		});
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');
		const [volume] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupVolumes);
		const [directory] = await volume.getChildren!();

		const contents = await directory.getChildren!();
		assert.deepStrictEqual(contents.map(node => node.name), ['old.csv']);
		// The child path is rebuilt from the parent path and the entry name, not from the reported
		// `path` column, whose scheme-qualified form LIST may not accept back.
		assert.deepStrictEqual(listed, [
			`LIST '/Volumes/main/sales/raw_files'`,
			`LIST '/Volumes/main/sales/raw_files/archive'`,
		]);
	});

	test('nothing under a volume offers a Data Explorer preview', async () => {
		// A volume holds files rather than rows, so no node beneath it is previewable.
		const mock = createMockClient((sql) => {
			if (/information_schema\.volumes/.test(sql)) {
				return { rows: [{ volume_name: 'raw_files' }] };
			}
			if (/^LIST /.test(sql)) {
				return { rows: [{ name: 'orders.parquet', size: 1 }, { name: 'archive/', size: 0 }] };
			}
			return { rows: [] };
		});
		const schemaNode = createSchemaNode(mock, noopHost, 'main', 'sales');
		const [volume] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupVolumes);
		const contents = await volume.getChildren!();

		assert.strictEqual(volume.preview, undefined);
		assert.deepStrictEqual(contents.map(node => node.preview), [undefined, undefined]);
	});

	test('file sizes are formatted for display', () => {
		assert.deepStrictEqual(
			[0, 512, 1024, 1536, 5 * 1024 * 1024, 3 * 1024 * 1024 * 1024].map(formatFileSize),
			['0 B', '512 B', '1.0 KB', '1.5 KB', '5.0 MB', '3.0 GB']);
	});

	test('getChildren after disconnect throws', async () => {
		const conn = createTestConnection(createMockClient());
		await conn.disconnect();

		await assert.rejects(() => conn.getChildren(), /closed/);
	});

	// --- Previews ---

	test('table node preview opens the table in the Data Explorer with its full identity', async () => {
		const opened: Array<{ datasetId: string; catalog: string; schemaName: string; tableName: string; kind: string }> = [];
		const host = {
			...noopHost,
			previewObject: async (client: any, catalog: string, schemaName: string, tableName: string, kind: 'table' | 'view') => {
				const datasetId = `databricks-test:${catalog}.${schemaName}.${tableName}`;
				opened.push({ datasetId, catalog, schemaName, tableName, kind });
				return datasetId;
			},
		};
		const mock = createMockClient(undefined, [relationRow('sales', 'orders', 'TABLE')]);
		const schemaNode = createSchemaNode(mock, host, 'main', 'sales');
		const [orders] = await groupChildren(schemaNode, positron.DataConnectionNodeKind.GroupTables);

		const datasetId = await orders.preview!();
		assert.deepStrictEqual(opened, [{
			datasetId: 'databricks-test:main.sales.orders',
			catalog: 'main',
			schemaName: 'sales',
			tableName: 'orders',
			kind: 'table',
		}]);
		assert.strictEqual(datasetId, 'databricks-test:main.sales.orders');
	});

	test('preview dataset ids do not collide for names containing delimiters', async () => {
		// Backtick-quoted Databricks names may contain '.' and ':', so the dataset id encodes each
		// component: `a.b`.`c` and `a`.`b.c` must not map onto the same id.
		const ids: string[] = [];
		const handler = {
			openTableView: async (datasetId: string) => { ids.push(datasetId); },
			openColumnView: async () => { },
			closeTableView: () => { },
		};
		const conn = new DatabricksConnection(TEST_CONFIG, handler);
		const client = createMockClient();
		// eslint-disable-next-line local/code-no-any-casts
		(conn as any)._client = client;

		// positron.dataExplorer.open is unavailable in this harness, so the ids are captured from the
		// handler and the open call is allowed to reject.
		await conn.previewObject(client, 'main', 'a.b', 'c', 'table').catch(() => { });
		await conn.previewObject(client, 'main', 'a', 'b.c', 'table').catch(() => { });

		assert.strictEqual(ids.length, 2);
		assert.notStrictEqual(ids[0], ids[1]);
	});
});

suite('Databricks Describe Parsing', () => {

	test('stops at the partition-information trailer', () => {
		// DESCRIBE repeats a partitioned table's partition columns after a metadata header; parsing
		// past the trailer would list them twice.
		const columns = parseDescribeRows([
			{ col_name: 'id', data_type: 'bigint' },
			{ col_name: 'event_date', data_type: 'date' },
			{ col_name: '', data_type: '' },
			{ col_name: '# Partition Information', data_type: '' },
			{ col_name: '# col_name', data_type: 'data_type' },
			{ col_name: 'event_date', data_type: 'date' },
		]);

		assert.deepStrictEqual(columns, [
			{ name: 'id', dataType: 'bigint' },
			{ name: 'event_date', dataType: 'date' },
		]);
	});

	test('maps Databricks types to display types', () => {
		const mapped = ['boolean', 'bigint', 'int', 'decimal(10,2)', 'decimal(10,0)', 'double', 'string',
			'varchar(32)', 'date', 'timestamp', 'timestamp_ntz', 'binary', 'map<string,int>', 'variant',
			'interval day to second', 'something_new']
			.map(type => [type, databricksDisplayType(type)]);

		assert.deepStrictEqual(mapped, [
			['boolean', 'boolean'],
			['bigint', 'integer'],
			['int', 'integer'],
			['decimal(10,2)', 'decimal'],
			// A zero-scale decimal holds only whole numbers, so it reads as an integer.
			['decimal(10,0)', 'integer'],
			['double', 'floating'],
			['string', 'string'],
			['varchar(32)', 'string'],
			['date', 'date'],
			['timestamp', 'datetime'],
			['timestamp_ntz', 'datetime'],
			['binary', 'object'],
			['map<string,int>', 'object'],
			['variant', 'object'],
			['interval day to second', 'interval'],
			// An unrecognized type is not guessed at as a string.
			['something_new', 'unknown'],
		]);
	});

	test('complex types are classified by their outer type, not their element type', () => {
		// 'array<timestamp>' contains "timestamp"; matching on the base type name keeps it an array.
		assert.strictEqual(databricksDisplayType('array<timestamp>'), 'array');
		assert.strictEqual(databricksDisplayType('struct<placed_at:timestamp,total:decimal(10,2)>'), 'struct');
		assert.strictEqual(databricksDisplayType('array<int>'), 'array');
	});
});

suite('Databricks Client', () => {

	/**
	 * Answers a query for the client generation it was issued on. The generation is the 1-based index of
	 * the SDK client the statement ran through, so a test can say "the first session is dead" without
	 * depending on timers to flip a flag at the right moment.
	 */
	type QueryHandler = (sql: string, generation: number) => Array<Record<string, unknown>>;

	/**
	 * Builds a client factory whose clients answer queries from `handler`. `connectErrors[n]` fails the
	 * nth client's connect, so the retry path can be exercised; `state` records the lifecycle.
	 */
	function fakeSdk(handler: QueryHandler, connectErrors: Array<Error | undefined> = []) {
		const state = {
			clientsCreated: 0,
			connects: 0,
			sessionsOpened: 0,
			sessionsClosed: 0,
			clientsClosed: 0,
			closedOperations: [] as string[],
			queries: [] as string[],
		};
		const factory: DatabricksSdkClientFactory = () => {
			const generation = ++state.clientsCreated;
			// Both statements and metadata calls resolve to an operation, so one builder serves each; the
			// metadata call is recorded under a synthetic label so tests can assert on it like a query.
			const openOperation = (label: string): IDatabricksOperation => {
				state.queries.push(label);
				return {
					fetchAll: async () => handler(label, generation),
					close: async () => { state.closedOperations.push(label); },
				};
			};
			const session: IDatabricksSession = {
				executeStatement: async (sql: string) => openOperation(sql),
				getTables: async (request) => openOperation(`getTables ${request.catalogName}.${request.schemaName}`),
				close: async () => { state.sessionsClosed++; },
			};
			const client: IDatabricksSdkClient = {
				connect: async () => {
					state.connects++;
					const error = connectErrors[generation - 1];
					if (error) {
						throw error;
					}
					return client;
				},
				openSession: async () => {
					state.sessionsOpened++;
					return session;
				},
				close: async () => { state.clientsClosed++; },
			};
			return client;
		};
		return { factory, state };
	}

	/** A handler whose first client's session is dead and whose later ones answer normally. */
	const firstSessionDead: QueryHandler = (_sql, generation) => {
		if (generation === 1) {
			throw new Error('Invalid SessionHandle: 01ee-...');
		}
		return [{ ok: 1 }];
	};

	/**
	 * A backoff hook that parks the client's connect-retry sleep until the test releases it, plus a
	 * `reached` promise that resolves once the client is parked there. Pairing the two gives the tests a
	 * deterministic "the reconnect is in flight right now" window with no timers to race.
	 */
	function parkedBackoff() {
		let release!: () => void;
		let reached!: () => void;
		const released = new Promise<void>(r => { release = r; });
		const reachedBackoff = new Promise<void>(r => { reached = r; });
		return {
			sleep: () => { reached(); return released; },
			reached: reachedBackoff,
			release,
		};
	}

	const noSleep = async () => { };

	test('maps each mechanism onto the SDK auth options', () => {
		const pat = connectionOptions({ ...TEST_CONFIG });
		const u2m = connectionOptions({ ...TEST_CONFIG, authType: 'u2m', token: undefined });
		const m2m = connectionOptions({ ...TEST_CONFIG, authType: 'm2m', token: undefined, clientId: 'cid', clientSecret: 'secret' });

		assert.strictEqual(pat.token, 'dapi-test-token');
		assert.strictEqual(pat.authType, undefined);
		assert.strictEqual(u2m.authType, 'databricks-oauth');
		assert.strictEqual(u2m.oauthClientId, undefined);
		assert.deepStrictEqual(
			{ authType: m2m.authType, id: m2m.oauthClientId, secret: m2m.oauthClientSecret },
			{ authType: 'databricks-oauth', id: 'cid', secret: 'secret' });
		// Every mechanism shares the locators and the precision/telemetry posture.
		assert.deepStrictEqual(
			{ host: pat.host, path: pat.path, precise: pat.preserveBigNumericPrecision, telemetry: pat.telemetryEnabled },
			{ host: TEST_CONFIG.host, path: TEST_CONFIG.httpPath, precise: true, telemetry: false });
	});

	test('passes queries through the connected session', async () => {
		const { factory, state } = fakeSdk(() => [{ n: 42 }]);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		const result = await client.query('SELECT count(*) AS n FROM t');
		assert.deepStrictEqual(result.rows, [{ n: 42 }]);
		assert.strictEqual(state.connects, 1);
		assert.strictEqual(state.sessionsOpened, 1);
		// The operation is released once its rows have been fetched.
		assert.deepStrictEqual(state.closedOperations, ['SELECT count(*) AS n FROM t']);
		await client.end();
	});

	test('lists relations through the metadata API, not a SQL statement', async () => {
		// The SHOW form cannot name a schema in a non-current catalog, so the listing must go through
		// getTables with the catalog as a parameter.
		const { factory, state } = fakeSdk(() => [{ TABLE_NAME: 'orders' }]);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		const result = await client.listTables('samples', 'accuweather');
		assert.deepStrictEqual(result.rows, [{ TABLE_NAME: 'orders' }]);
		assert.deepStrictEqual(state.queries, ['getTables samples.accuweather']);
		assert.deepStrictEqual(state.closedOperations, ['getTables samples.accuweather']);
		await client.end();
	});

	test('a metadata listing recovers across a dead session too', async () => {
		const { factory, state } = fakeSdk(firstSessionDead);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		const result = await client.listTables('samples', 'accuweather');
		assert.deepStrictEqual(result.rows, [{ ok: 1 }]);
		assert.strictEqual(state.clientsCreated, 2);
		await client.end();
	});

	test('closes the operation even when fetching fails', async () => {
		const { factory, state } = fakeSdk(() => { throw new Error('AnalysisException: cannot resolve `nope`'); });
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		await assert.rejects(() => client.query('SELECT nope FROM t'), /cannot resolve/);
		assert.deepStrictEqual(state.closedOperations, ['SELECT nope FROM t']);
		await client.end();
	});

	test('reconnects once and retries when the session is dead', async () => {
		const { factory, state } = fakeSdk(firstSessionDead);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		const result = await client.query('SELECT 1');
		assert.deepStrictEqual(result.rows, [{ ok: 1 }]);
		// One reconnect: a second connect and session, and the dead one torn down.
		assert.deepStrictEqual(
			{ connects: state.connects, sessions: state.sessionsOpened, clientsClosed: state.clientsClosed },
			{ connects: 2, sessions: 2, clientsClosed: 1 });
		await client.end();
	});

	test('does not reconnect on a non-connection error', async () => {
		const { factory, state } = fakeSdk(() => { throw new Error('TABLE_OR_VIEW_NOT_FOUND'); });
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		await assert.rejects(() => client.query('SELECT * FROM nope'), /TABLE_OR_VIEW_NOT_FOUND/);
		assert.strictEqual(state.connects, 1);
		await client.end();
	});

	test('coalesces concurrent reconnects into one', async () => {
		const { factory, state } = fakeSdk(firstSessionDead);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);
		await client.connect();

		// Every in-flight query hits the dead session; one shared reconnect revives them all.
		const results = await Promise.all([client.query('SELECT 1'), client.query('SELECT 2'), client.query('SELECT 3')]);

		assert.deepStrictEqual(results.map(r => r.rows), [[{ ok: 1 }], [{ ok: 1 }], [{ ok: 1 }]]);
		// Three failed queries, but only one rebuild.
		assert.strictEqual(state.clientsCreated, 2);
		assert.strictEqual(state.sessionsOpened, 2);
		await client.end();
	});

	test('retries a transient failure during connect', async () => {
		const { factory, state } = fakeSdk(() => [], [new Error('socket hang up')]);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);

		await client.connect();
		assert.strictEqual(state.connects, 2);
		await client.end();
	});

	test('does not retry a terminal error during connect', async () => {
		const { factory, state } = fakeSdk(() => [], [new Error('Invalid access token')]);
		const client = new DatabricksClient(TEST_CONFIG, factory, noSleep);

		await assert.rejects(() => client.connect(), /Invalid access token/);
		assert.strictEqual(state.connects, 1);
		// The half-open client is torn down rather than left dangling.
		assert.strictEqual(state.clientsClosed, 1);
	});

	test('a query starting during a reconnect waits for it instead of failing as closed', async () => {
		// The second client's connect fails transiently, so the reconnect parks in the backoff sleep and
		// the window a query can arrive in is held open for as long as the test wants.
		const backoff = parkedBackoff();
		const { factory } = fakeSdk(firstSessionDead, [undefined, new Error('socket hang up')]);
		const client = new DatabricksClient(TEST_CONFIG, factory, backoff.sleep);
		await client.connect();

		// This query finds the dead session and starts the reconnect, which parks in the backoff.
		const first = client.query('SELECT 1');
		await backoff.reached;
		// This one arrives mid-reconnect: `_session` is transiently null, but the client is not closed.
		const second = client.query('SELECT 2');
		backoff.release();
		const [a, b] = await Promise.all([first, second]);

		assert.deepStrictEqual(a.rows, [{ ok: 1 }]);
		assert.deepStrictEqual(b.rows, [{ ok: 1 }]);
		await client.end();
	});

	test('end() during a reconnect tears down the session the reconnect installs', async () => {
		const backoff = parkedBackoff();
		const { factory, state } = fakeSdk(firstSessionDead, [undefined, new Error('socket hang up')]);
		const client = new DatabricksClient(TEST_CONFIG, factory, backoff.sleep);
		await client.connect();

		// Start a query that triggers a reconnect, park it in the backoff, then close mid-rebuild.
		const pending = client.query('SELECT 1');
		await backoff.reached;
		const ended = client.end();
		backoff.release();
		await ended;
		await pending.catch(() => { /* the closed client may reject the retry */ });

		// Whatever the reconnect installed has been closed: no live session outlives end().
		assert.strictEqual(state.sessionsClosed, state.sessionsOpened);
		assert.strictEqual(state.clientsClosed, state.clientsCreated);
	});
});

suite('Databricks Host and Path Parsing', () => {

	test('bare hostname is unchanged', () => {
		assert.strictEqual(parseDatabricksHost('dbc-a1b2c3d4.cloud.databricks.com'), 'dbc-a1b2c3d4.cloud.databricks.com');
	});

	test('full workspace URL is reduced to the hostname', () => {
		assert.strictEqual(parseDatabricksHost('https://dbc-a1b2c3d4.cloud.databricks.com/'), 'dbc-a1b2c3d4.cloud.databricks.com');
		assert.strictEqual(parseDatabricksHost('https://adb-1234567890123456.7.azuredatabricks.net/?o=1234567890123456'), 'adb-1234567890123456.7.azuredatabricks.net');
	});

	test('trailing path, port, and surrounding whitespace are stripped', () => {
		assert.strictEqual(parseDatabricksHost('  https://example.cloud.databricks.com/sql/warehouses/abc  '), 'example.cloud.databricks.com');
		assert.strictEqual(parseDatabricksHost('example.cloud.databricks.com:443'), 'example.cloud.databricks.com');
	});

	test('an API http path is unchanged', () => {
		assert.strictEqual(parseDatabricksHttpPath('/sql/1.0/warehouses/abc123def456'), '/sql/1.0/warehouses/abc123def456');
		assert.strictEqual(parseDatabricksHttpPath('sql/protocolv1/o/1234567890/0101-cluster'), '/sql/protocolv1/o/1234567890/0101-cluster');
	});

	test('a bare warehouse id is expanded to the warehouse path', () => {
		assert.strictEqual(parseDatabricksHttpPath('abc123def456'), '/sql/1.0/warehouses/abc123def456');
	});

	test('a warehouse URL copied from the console is rewritten to the API path', () => {
		// The console URL omits the API version, which the SQL endpoint requires.
		assert.strictEqual(parseDatabricksHttpPath('https://example.cloud.databricks.com/sql/warehouses/abc123'), '/sql/1.0/warehouses/abc123');
		assert.strictEqual(parseDatabricksHttpPath('/sql/warehouses/abc123'), '/sql/1.0/warehouses/abc123');
	});

	test('a workspace-id query is preserved and a trailing slash dropped', () => {
		// The SDK reads `?o=` for account-level routing, so it must survive normalization.
		assert.strictEqual(parseDatabricksHttpPath('/sql/1.0/warehouses/abc123?o=1234567890'), '/sql/1.0/warehouses/abc123?o=1234567890');
		assert.strictEqual(parseDatabricksHttpPath('/sql/1.0/warehouses/abc123/'), '/sql/1.0/warehouses/abc123');
	});
});

suite('Databricks Required Parameters', () => {

	const locators = { host: 'example.cloud.databricks.com', httpPath: '/sql/1.0/warehouses/abc' };

	test('the locators are required by every mechanism', () => {
		for (const mechanism of ['pat', 'oauth-u2m', 'oauth-m2m']) {
			assert.throws(() => validateRequired(mechanism, { httpPath: locators.httpPath }), /Server Hostname is required/);
			assert.throws(() => validateRequired(mechanism, { host: locators.host }), /HTTP Path is required/);
		}
	});

	test('each mechanism requires its own credentials', () => {
		assert.throws(() => validateRequired('pat', { ...locators }), /Access Token is required/);
		assert.throws(() => validateRequired('oauth-m2m', { ...locators }), /Client ID is required/);
		assert.throws(() => validateRequired('oauth-m2m', { ...locators, clientId: 'cid' }), /Client Secret is required/);
		// Interactive sign-in needs nothing beyond the locators.
		assert.doesNotThrow(() => validateRequired('oauth-u2m', { ...locators }));
	});

	test('an unknown mechanism is rejected', () => {
		assert.throws(() => validateRequired('nope', { ...locators }), /Unknown connection mechanism/);
	});
});

suite('Databricks Connection Code', () => {

	// A pasted console URL and a bare warehouse id, so the generated code is also asserted to carry
	// the normalized locators rather than whatever the user typed.
	const locators = {
		host: 'https://example.cloud.databricks.com/',
		httpPath: '/sql/warehouses/abc123',
	};

	function code(mechanismId: string, languageId: string, params: Record<string, string>): string {
		const variants = generateConnectionCode(mechanismId, languageId, { ...locators, ...params });
		return variants.length > 0 ? variants[0].code : '';
	}

	test('Python PAT code carries the normalized locators and the token', () => {
		assert.strictEqual(code('pat', 'python', { token: 'dapi123' }),
			'from databricks import sql\n\n' +
			'conn = sql.connect(\n' +
			'\tserver_hostname="example.cloud.databricks.com",\n' +
			'\thttp_path="/sql/1.0/warehouses/abc123",\n' +
			'\taccess_token="dapi123",\n' +
			')\n');
	});

	test('Python U2M code asks the connector for the browser flow', () => {
		assert.strictEqual(code('oauth-u2m', 'python', { catalog: 'main', schema: 'sales' }),
			'from databricks import sql\n\n' +
			'conn = sql.connect(\n' +
			'\tserver_hostname="example.cloud.databricks.com",\n' +
			'\thttp_path="/sql/1.0/warehouses/abc123",\n' +
			'\tauth_type="databricks-oauth",\n' +
			'\tcatalog="main",\n' +
			'\tschema="sales",\n' +
			')\n');
	});

	test('Python M2M code builds a service-principal credentials provider', () => {
		// The connector has no inline client-credentials option, so the code defines the provider the
		// SDK expects rather than passing the secret to sql.connect directly.
		const generated = code('oauth-m2m', 'python', { clientId: 'cid', clientSecret: 'secret' });
		assert.match(generated, /from databricks\.sdk\.core import Config, oauth_service_principal/);
		assert.match(generated, /host="https:\/\/example\.cloud\.databricks\.com",/);
		assert.match(generated, /client_id="cid",/);
		assert.match(generated, /credentials_provider=credential_provider,/);
	});

	test('R PAT code passes the token as the password with the "token" user', () => {
		assert.strictEqual(code('pat', 'r', { token: 'dapi123' }),
			'library(DBI)\n\n' +
			'con <- dbConnect(\n' +
			'\todbc::databricks(),\n' +
			'\tworkspace = "https://example.cloud.databricks.com",\n' +
			'\thttpPath = "/sql/1.0/warehouses/abc123",\n' +
			'\tuid = "token",\n' +
			'\tpwd = "dapi123"\n' +
			')\n');
	});

	test('R U2M code supplies no credentials, leaving odbc to run the browser flow', () => {
		const generated = code('oauth-u2m', 'r', {});
		assert.match(generated, /odbc::databricks\(\)/);
		assert.doesNotMatch(generated, /pwd|uid/);
	});

	test('no code is generated where it cannot be faithful', () => {
		// R has no inline form for a service principal's credentials; an unsupported language and a
		// missing required parameter likewise yield nothing rather than half-working code.
		assert.deepStrictEqual(generateConnectionCode('oauth-m2m', 'r', { ...locators, clientId: 'cid', clientSecret: 's' }), []);
		assert.deepStrictEqual(generateConnectionCode('pat', 'julia', { ...locators, token: 'dapi123' }), []);
		assert.deepStrictEqual(generateConnectionCode('pat', 'python', { ...locators }), []);
		assert.deepStrictEqual(generateConnectionCode('pat', 'python', { token: 'dapi123' }), []);
	});

	test('quotes in a value are escaped rather than closing the literal', () => {
		const generated = code('pat', 'python', { token: 'dapi"123', catalog: 'my"catalog' });
		assert.match(generated, /access_token="dapi\\"123"/);
		assert.match(generated, /catalog="my\\"catalog"/);
	});
});
