/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as positron from 'positron';
import { DuckDBWorkerClient } from 'positron-data-explorer-duckdb';
import { createDatabasesGroupNode, IDuckDBPreviewHost } from '../duckdbNodes.js';

suite('DuckDB Nodes Tests', () => {
	let tmpDir: string;
	let client: DuckDBWorkerClient;
	let previews: Array<Array<string | undefined>>;
	let host: IDuckDBPreviewHost;

	setup(async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-duckdb-nodes-'));
		client = new DuckDBWorkerClient({ databasePath: path.join(tmpDir, 'home.duckdb'), readOnly: false });
		await client.runQuery(`ATTACH ':memory:' AS other`);
		await client.runQuery(`CREATE SCHEMA other.s`);
		await client.runQuery(`CREATE TABLE other.s.t (id INTEGER PRIMARY KEY, v VARCHAR)`);
		previews = [];
		host = {
			async previewObject(database, schemaName, tableName, kind) {
				previews.push([database, schemaName, tableName, kind]);
				return 'ds';
			},
			async previewColumn(database, schemaName, tableName, kind, columnName) {
				previews.push([database, schemaName, tableName, kind, columnName]);
				return 'ds';
			},
		};
	});

	teardown(async () => {
		client.dispose();
		await fs.promises.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	});

	async function child(node: positron.DataConnectionNode, name: string): Promise<positron.DataConnectionNode> {
		const found = (await node.getChildren!()).find(n => n.name === name);
		assert.ok(found, `expected a child named ${name}`);
		return found;
	}

	test('Databases root lists attached databases, not only the current one', async () => {
		const root = createDatabasesGroupNode(client, host);
		assert.strictEqual(root.name, 'Databases');
		assert.strictEqual(root.kind, positron.DataConnectionNodeKind.GroupDatabases);
		const databases = await root.getChildren!();
		assert.deepStrictEqual(databases.map(d => d.name), ['home', 'other']);
		assert.ok(databases.every(d => d.kind === positron.DataConnectionNodeKind.Database));
	});

	test('a database node expands to its own schemas and tables', async () => {
		const root = createDatabasesGroupNode(client, host);

		const other = await child(root, 'other');
		const otherSchemas = await child(other, 'Schemas');
		const s = await child(otherSchemas, 's');
		const tables = await child(s, 'Tables');
		assert.deepStrictEqual((await tables.getChildren!()).map(t => t.name), ['t']);

		const home = await child(root, 'home');
		const homeSchemas = await child(home, 'Schemas');
		assert.ok(!(await homeSchemas.getChildren!()).some(n => n.name === 's'));
	});

	test('previewing a table passes its database', async () => {
		const root = createDatabasesGroupNode(client, host);
		const schemas = await child(await child(root, 'other'), 'Schemas');
		const tables = await child(await child(schemas, 's'), 'Tables');
		const t = await child(tables, 't');
		await t.preview!();
		assert.deepStrictEqual(previews, [['other', 's', 't', 'table']]);
	});

	test('columns and primary key resolve in a non-default database', async () => {
		const root = createDatabasesGroupNode(client, host);
		const schemas = await child(await child(root, 'other'), 'Schemas');
		const tables = await child(await child(schemas, 's'), 'Tables');
		const t = await child(tables, 't');
		const fields = await (await child(t, 'Columns')).getChildren!();
		assert.deepStrictEqual(
			fields.map(f => [f.name, f.isPrimaryKey]),
			[['id', true], ['v', false]]
		);
		await fields[1].preview!();
		assert.deepStrictEqual(previews, [['other', 's', 't', 'table', 'v']]);
	});
});
