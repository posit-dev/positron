/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as positron from 'positron';
import { DuckDBWorkerClient, IDuckDBDataExplorerHost, IDuckDBQueryClient, WorkerOpenConfig } from 'positron-data-explorer-duckdb';
import { MotherDuckConnection } from '../motherduckConnection.js';

const TOKEN = 'aaa.bbb.ccc';
const AUTH_DETAIL = 'IO Error: Not authenticated. Please check your MotherDuck token';
const DOWNLOAD_DETAIL = 'Failed to download extension "motherduck" at URL "http://extensions.duckdb.org/x"';

suite('MotherDuck Connection', () => {
	let tmpDir: string;
	let realClients: DuckDBWorkerClient[];
	let opened: unknown[][];
	let closed: string[];
	let handler: IDuckDBDataExplorerHost;
	let logLines: string[];
	let logger: positron.DataConnectionLogger;

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-duckdb-md-'));
		realClients = [];
		opened = [];
		closed = [];
		logLines = [];
		handler = {
			async openTableView(...args: unknown[]) {
				opened.push(args);
			},
			async openColumnView(...args: unknown[]) {
				opened.push(args);
			},
			closeTableView(datasetId: string) {
				closed.push(datasetId);
			},
		} as IDuckDBDataExplorerHost;
		const log = (line: string) => { logLines.push(line); };
		logger = { info: log, warn: log, error: log, debug: log, trace: log } as unknown as positron.DataConnectionLogger;
	});

	teardown(async () => {
		for (const client of realClients) {
			client.dispose();
		}
		await fs.promises.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	});

	function localClient(): DuckDBWorkerClient {
		const client = new DuckDBWorkerClient({ databasePath: path.join(tmpDir, 'home.duckdb'), readOnly: false });
		realClients.push(client);
		return client;
	}

	function failingClient(detail: string): { client: DuckDBWorkerClient; disposed: () => boolean } {
		let disposed = false;
		const client = {
			isAlive: true,
			async runQuery() { throw new Error(detail); },
			dispose() { disposed = true; },
		} as unknown as DuckDBWorkerClient;
		return { client, disposed: () => disposed };
	}

	test('connect passes the md: path and token to the worker config', async () => {
		const configs: WorkerOpenConfig[] = [];
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: 'sample_data', readOnly: true }, handler, undefined,
			config => { configs.push(config); return localClient(); });
		await conn.connect();
		assert.deepStrictEqual(configs, [{ databasePath: 'md:sample_data', readOnly: true, motherduckToken: TOKEN }]);
		assert.strictEqual(await conn.isConnected(), true);
		assert.strictEqual(await conn.isReadOnly(), true);
		await conn.disconnect();
	});

	test('a blank token is refused without creating a client', async () => {
		let created = 0;
		const conn = new MotherDuckConnection(
			{ token: '   ', database: undefined, readOnly: false }, handler, logger,
			() => { created++; return localClient(); });
		await assert.rejects(conn.connect(), (err: Error) => err.message === 'A MotherDuck access token is required.');
		assert.strictEqual(created, 0);
	});

	test('auth failure gives a clear message without the token', async () => {
		const configs: WorkerOpenConfig[] = [];
		const failing = failingClient(`${AUTH_DETAIL} ${TOKEN}`);
		const conn = new MotherDuckConnection(
			{ token: `  ${TOKEN}\n`, database: undefined, readOnly: false }, handler, logger,
			config => { configs.push(config); return failing.client; });
		await assert.rejects(conn.connect(), (err: Error) => {
			assert.ok(err.message.startsWith('MotherDuck rejected the access token'), err.message);
			assert.ok(!err.message.includes(TOKEN), err.message);
			return true;
		});
		assert.strictEqual(configs[0].motherduckToken, TOKEN);
		assert.ok(failing.disposed());
		assert.ok(logLines.length > 0);
		assert.ok(logLines.every(l => !l.includes(TOKEN)), logLines.join('\n'));
	});

	test('extension download failure gives a clear message', async () => {
		const failing = failingClient(DOWNLOAD_DETAIL);
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => failing.client);
		await assert.rejects(conn.connect(), (err: Error) => {
			assert.ok(err.message.startsWith('Could not install the MotherDuck extension'), err.message);
			return true;
		});
		assert.ok(failing.disposed());
	});

	test('a missing database gives a clear message', async () => {
		const failing = failingClient('Invalid Input Error: Initialization function "motherduck_duckdb_cpp_init" threw an exception: "Failed to attach \'nosuchdb\': no database/share named "nosuchdb" found');
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: 'nosuchdb', readOnly: false }, handler, logger, () => failing.client);
		await assert.rejects(conn.connect(), { message: 'MotherDuck has no database named \'nosuchdb\'. Check the default database name.' });
	});

	test('errors from tree queries after connect are scrubbed of the token', async () => {
		let probed = false;
		const client = {
			isAlive: true,
			async runQuery() {
				if (!probed) {
					probed = true;
					return [];
				}
				throw new Error(`Request failed for token ${TOKEN}`);
			},
			dispose() { },
		} as unknown as DuckDBWorkerClient;
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => client);
		await conn.connect();
		const [databases] = await conn.getChildren();
		await assert.rejects(async () => databases.getChildren!(), { message: 'Request failed for token <redacted>' });
	});

	test('other failure gives a generic message', async () => {
		const failing = failingClient('boom');
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => failing.client);
		await assert.rejects(conn.connect(), /^Error: Failed to connect to MotherDuck\. boom$/);
	});

	test('a hung open times out, disposes the client, and leaves the connection closed', async () => {
		let disposed = false;
		const hanging = {
			isAlive: true,
			runQuery() { return new Promise(() => { }); },
			dispose() { disposed = true; },
		} as unknown as DuckDBWorkerClient;
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => hanging, 50);
		await assert.rejects(conn.connect(), (err: Error) => {
			assert.ok(err.message.startsWith('Timed out connecting to MotherDuck'), err.message);
			return true;
		});
		assert.ok(disposed);
		assert.strictEqual(await conn.isConnected(), false);
	});

	test('a second connect reuses the open client', async () => {
		let created = 0;
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger,
			() => { created++; return localClient(); });
		await conn.connect();
		await conn.connect();
		assert.strictEqual(created, 1);
		await conn.disconnect();
	});

	test('tree and preview work across attached databases', async () => {
		const client = localClient();
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => client);
		await conn.connect();
		await client.runQuery(`ATTACH ':memory:' AS other`);
		await client.runQuery(`CREATE TABLE other.main.t AS SELECT 1 AS a`);

		const children = await conn.getChildren();
		assert.deepStrictEqual(children.map(c => c.name), ['Databases']);
		const other = (await children[0].getChildren!()).find(n => n.name === 'other');
		assert.ok(other);
		const schemas = (await other.getChildren!()).find(n => n.name === 'Schemas')!;
		const main = (await schemas.getChildren!()).find(n => n.name === 'main')!;
		const tables = (await main.getChildren!()).find(n => n.name === 'Tables')!;
		const t = (await tables.getChildren!()).find(n => n.name === 't')!;
		await t.preview!();

		assert.strictEqual(opened.length, 1);
		const [datasetId, usedClient, ...rest] = opened[0];
		assert.match(datasetId as string, /^motherduck:[^:]+:table:\["other","main","t"\]$/);
		// Previews get the token-scrubbing wrapper, backed by the same worker (the in-memory attach
		// exists only there).
		assert.deepStrictEqual(await (usedClient as IDuckDBQueryClient).runQuery('SELECT a FROM other.main.t'), [{ a: 1 }]);
		assert.deepStrictEqual(rest, ['other', 'main', 't', 'table']);

		await conn.disconnect();
		assert.deepStrictEqual(closed, [datasetId]);
	});

	test('dataset ids stay distinct when names contain dots', async () => {
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => localClient());
		await conn.connect();
		const ids = [
			await conn.previewObject('db', 'a.b', 'c', 'table'),
			await conn.previewObject('db', 'a', 'b.c', 'table'),
			await conn.previewObject('db.a', 'b', 'c', 'table'),
			await conn.previewColumn('db', 's', 't.u', 'table', 'v'),
			await conn.previewColumn('db', 's', 't', 'table', 'u.v'),
		];
		assert.strictEqual(new Set(ids).size, ids.length, ids.join('\n'));
		await conn.disconnect();
	});

	test('disconnect disposes the client and is idempotent', async () => {
		let disposals = 0;
		const client = localClient();
		const realDispose = client.dispose.bind(client);
		client.dispose = () => { disposals++; realDispose(); };
		const conn = new MotherDuckConnection(
			{ token: TOKEN, database: undefined, readOnly: false }, handler, logger, () => client);
		await conn.connect();
		await conn.disconnect();
		await conn.disconnect();
		assert.strictEqual(disposals, 1);
		assert.strictEqual(await conn.isConnected(), false);
		await assert.rejects(conn.getChildren(), /closed/);
	});
});
