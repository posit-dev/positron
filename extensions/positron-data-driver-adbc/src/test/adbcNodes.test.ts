/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { createColumnsGroupNode, createRootNodes, isViewType } from '../adbcNodes.js';
import { AdbcTableRef, IAdbcMetadataClient } from '../adbcWorkerClient.js';
import { WorkerCatalogInfo, WorkerColumnSchema, WorkerObjectDepth } from '../adbcWorkerProtocol.js';

/** A no-op preview host: these tests exercise schema browsing, not previewing. */
const noopHost = {
	previewObject: async () => { },
	previewColumn: async () => { },
};

/** A request recorded by the fake client, so tests can assert on depth and filters. */
interface RecordedRequest {
	depth: WorkerObjectDepth;
	catalog?: string;
	dbSchema?: string;
	tableName?: string;
}

/**
 * A fake metadata client answering getObjects from a caller-supplied responder, keyed by
 * the requested depth. Records every request so tests can check the tree asks for the
 * right level rather than over-fetching.
 */
class FakeMetadataClient implements IAdbcMetadataClient {
	readonly requests: RecordedRequest[] = [];

	constructor(private readonly responder: (request: RecordedRequest) => WorkerCatalogInfo[]) { }

	async runQuery(): Promise<Array<Record<string, unknown>>> {
		throw new Error('not used by these tests');
	}

	async getObjects(options: RecordedRequest): Promise<WorkerCatalogInfo[]> {
		this.requests.push(options);
		return this.responder(options);
	}

	async getTableSchema(_ref: AdbcTableRef): Promise<WorkerColumnSchema[]> {
		throw new Error('not used by these tests');
	}

	async getQuerySchema(_sql: string): Promise<WorkerColumnSchema[]> {
		throw new Error('not used by these tests');
	}
}

/** Finds the single child node of the given kind. */
function childOfKind(nodes: positron.DataConnectionNode[], kind: positron.DataConnectionNodeKind): positron.DataConnectionNode {
	const node = nodes.find(candidate => candidate.kind === kind);
	assert.ok(node, `expected a node of kind ${kind}, got ${nodes.map(n => n.kind).join(', ')}`);
	return node;
}

suite('ADBC Nodes Tests', () => {
	suite('isViewType', () => {
		test('recognizes view types regardless of case and spelling', () => {
			const mapping: Array<[string, boolean]> = [
				['view', true],
				['VIEW', true],
				['Materialized View', true],
				['table', false],
				['TABLE', false],
				['BASE TABLE', false],
				// An unrecognized type groups with tables rather than disappearing from the tree.
				['EXTERNAL', false],
			];
			assert.deepStrictEqual(
				mapping.map(([type]) => [type, isViewType(type)]),
				mapping);
		});
	});

	suite('createRootNodes', () => {
		test('shows a Databases group when the driver reports named catalogs', async () => {
			const client = new FakeMetadataClient(() => [{ name: 'sales' }, { name: 'ops' }]);
			const roots = await createRootNodes(client, noopHost);

			const group = childOfKind(roots, positron.DataConnectionNodeKind.GroupDatabases);
			const catalogs = await group.getChildren!();
			assert.deepStrictEqual(catalogs.map(node => node.name), ['sales', 'ops']);
			assert.deepStrictEqual(client.requests, [{ depth: WorkerObjectDepth.Catalogs }]);
		});

		test('elides a single unnamed catalog and schema, showing Tables and Views directly', async () => {
			// SQLite-shaped metadata: one catalog, one schema with an empty name.
			const client = new FakeMetadataClient(request =>
				request.depth === WorkerObjectDepth.Catalogs
					? [{ name: '' }]
					: [{ name: '', schemas: [{ name: '' }] }]);

			const roots = await createRootNodes(client, noopHost);

			assert.deepStrictEqual(
				roots.map(node => [node.name, node.kind]),
				[
					['Tables', positron.DataConnectionNodeKind.GroupTables],
					['Views', positron.DataConnectionNodeKind.GroupViews],
				]);
		});

		test('elides a single unnamed schema beneath a named catalog', async () => {
			const client = new FakeMetadataClient(request =>
				request.depth === WorkerObjectDepth.Catalogs
					? [{ name: 'main' }]
					: [{ name: 'main', schemas: [{ name: '' }] }]);

			const roots = await createRootNodes(client, noopHost);
			const catalogs = await childOfKind(roots, positron.DataConnectionNodeKind.GroupDatabases).getChildren!();
			const beneathCatalog = await catalogs[0].getChildren!();

			assert.deepStrictEqual(
				beneathCatalog.map(node => node.name),
				['Tables', 'Views']);
		});

		test('shows a Schemas group when the driver reports named schemas', async () => {
			const client = new FakeMetadataClient(request =>
				request.depth === WorkerObjectDepth.Catalogs
					? [{ name: 'warehouse' }]
					: [{ name: 'warehouse', schemas: [{ name: 'public' }, { name: 'staging' }] }]);

			const roots = await createRootNodes(client, noopHost);
			const catalogs = await childOfKind(roots, positron.DataConnectionNodeKind.GroupDatabases).getChildren!();
			const schemasGroup = childOfKind(
				await catalogs[0].getChildren!(), positron.DataConnectionNodeKind.GroupSchemas);

			assert.deepStrictEqual(
				(await schemasGroup.getChildren!()).map(node => [node.name, node.kind]),
				[
					['public', positron.DataConnectionNodeKind.Schema],
					['staging', positron.DataConnectionNodeKind.Schema],
				]);
		});
	});

	suite('table and view grouping', () => {
		test('partitions the driver-reported tables into the Tables and Views groups', async () => {
			const client = new FakeMetadataClient(request => {
				if (request.depth === WorkerObjectDepth.Catalogs) {
					return [{ name: '' }];
				}
				if (request.depth === WorkerObjectDepth.Schemas) {
					return [{ name: '', schemas: [{ name: '' }] }];
				}
				return [{
					name: '',
					schemas: [{
						name: '',
						tables: [
							{ name: 'orders', tableType: 'table' },
							{ name: 'order_summary', tableType: 'VIEW' },
							{ name: 'customers', tableType: 'BASE TABLE' },
						],
					}],
				}];
			});

			const roots = await createRootNodes(client, noopHost);
			const tables = await childOfKind(roots, positron.DataConnectionNodeKind.GroupTables).getChildren!();
			const views = await childOfKind(roots, positron.DataConnectionNodeKind.GroupViews).getChildren!();

			assert.deepStrictEqual(
				{
					tables: tables.map(node => [node.name, node.kind]),
					views: views.map(node => [node.name, node.kind]),
				},
				{
					tables: [
						['orders', positron.DataConnectionNodeKind.Table],
						['customers', positron.DataConnectionNodeKind.Table],
					],
					views: [['order_summary', positron.DataConnectionNodeKind.View]],
				});
		});
	});

	suite('createColumnsGroupNode', () => {
		const columnsResponse: WorkerCatalogInfo[] = [{
			name: 'main',
			schemas: [{
				name: 'public',
				tables: [{
					name: 'orders',
					tableType: 'table',
					columns: [
						{ name: 'id', typeName: 'INTEGER' },
						{ name: 'total', typeName: 'DECIMAL' },
					],
					primaryKeyColumns: ['id'],
				}],
			}],
		}];

		test('lists columns with their vendor type and primary-key membership', async () => {
			const client = new FakeMetadataClient(() => columnsResponse);
			const ref: AdbcTableRef = { catalog: 'main', dbSchema: 'public', tableName: 'orders' };

			const columns = await createColumnsGroupNode(client, noopHost, ref, 'table').getChildren!();

			assert.deepStrictEqual(
				columns.map(node => [node.name, node.dataType, node.isPrimaryKey]),
				[
					['id', 'INTEGER', true],
					['total', 'DECIMAL', false],
				]);
		});

		test('requests full depth scoped to the one table', async () => {
			const client = new FakeMetadataClient(() => columnsResponse);
			const ref: AdbcTableRef = { catalog: 'main', dbSchema: 'public', tableName: 'orders' };

			await createColumnsGroupNode(client, noopHost, ref, 'table').getChildren!();

			assert.deepStrictEqual(client.requests, [{
				depth: WorkerObjectDepth.All,
				catalog: 'main',
				dbSchema: 'public',
				tableName: 'orders',
			}]);
		});

		test('never marks a view column as a primary key', async () => {
			// A driver may report constraints for a view; columns under a view are still not keys.
			const client = new FakeMetadataClient(() => columnsResponse);
			const ref: AdbcTableRef = { catalog: 'main', dbSchema: 'public', tableName: 'orders' };

			const columns = await createColumnsGroupNode(client, noopHost, ref, 'view').getChildren!();

			assert.deepStrictEqual(columns.map(node => node.isPrimaryKey), [false, false]);
		});

		test('returns no columns when the driver does not report the table', async () => {
			const client = new FakeMetadataClient(() => []);
			const ref: AdbcTableRef = { tableName: 'missing' };

			assert.deepStrictEqual(await createColumnsGroupNode(client, noopHost, ref, 'table').getChildren!(), []);
		});
	});
});
