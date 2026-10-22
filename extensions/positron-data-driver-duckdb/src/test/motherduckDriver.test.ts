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
import { DuckDBDataExplorerRpcHandler, DuckDBWorkerClient, WorkerOpenConfig } from 'positron-data-explorer-duckdb';
import { createMotherDuckDriver, MotherDuckDriverDeps } from '../motherduckDriver.js';

const MISSING_TOKEN_MESSAGE = 'Set the motherduck_token environment variable to your MotherDuck access token, then restart Positron and reconnect. For example, add export motherduck_token=\'<token>\' to your shell profile, or on Windows, add it to your user environment variables.';

suite('MotherDuck Driver', () => {
	let tmpDir: string;
	let clients: DuckDBWorkerClient[];
	let configs: WorkerOpenConfig[];

	setup(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-data-driver-motherduck-'));
		clients = [];
		configs = [];
	});

	teardown(async () => {
		for (const client of clients) {
			client.dispose();
		}
		await fs.promises.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	});

	// Records the worker config and opens a local DuckDB file instead, so no test ever opens `md:`.
	function recordingClient(config: WorkerOpenConfig): DuckDBWorkerClient {
		configs.push(config);
		const client = new DuckDBWorkerClient({ databasePath: path.join(tmpDir, 'local.duckdb'), readOnly: false });
		clients.push(client);
		return client;
	}

	function createDriver(deps: MotherDuckDriverDeps = {}): positron.DataConnectionDriver {
		const extension = vscode.extensions.getExtension('positron.positron-data-driver-duckdb');
		assert.ok(extension, 'the DuckDB driver extension should be present');
		const context = { extensionPath: extension.extensionPath } as vscode.ExtensionContext;
		return createMotherDuckDriver(context, {} as DuckDBDataExplorerRpcHandler, undefined, { createClient: recordingClient, ...deps });
	}

	test('driver metadata', () => {
		const driver = createDriver();
		const parameters = driver.mechanisms[0].parameters;
		assert.deepStrictEqual(
			{
				id: driver.id,
				name: driver.name,
				languages: driver.supportedLanguageIds,
				mechanisms: driver.mechanisms.map(m => m.id),
				parameters: parameters.map(p => p.id),
				hasSecret: parameters.some(p => (p as { secret?: boolean }).secret),
				readOnlyDefault: (parameters[1] as { defaultValue?: boolean }).defaultValue,
				hasIcon: !!driver.iconSvg && driver.iconSvg.includes('<svg'),
			},
			{
				id: 'positron-data-driver-motherduck',
				name: 'MotherDuck',
				languages: process.platform === 'win32' ? ['python', 'ggsql'] : ['python', 'r', 'ggsql'],
				mechanisms: ['envvar'],
				parameters: ['database', 'readOnly'],
				hasSecret: false,
				readOnlyDefault: true,
				hasIcon: true,
			}
		);
	});

	test('connect rejects a missing or blank motherduck_token without opening', async () => {
		const start = Date.now();
		for (const env of [{}, { motherduck_token: '   ' }]) {
			await assert.rejects(async () => createDriver({ env }).connect('envvar', { database: 'sample_data' }),
				{ message: MISSING_TOKEN_MESSAGE });
		}
		assert.deepStrictEqual(configs, []);
		assert.ok(Date.now() - start < 2000);
	});

	test('connect passes the trimmed motherduck_token to the worker', async () => {
		const driver = createDriver({ env: { motherduck_token: '  aaa.bbb.ccc\n' } });
		const connection = await driver.connect('envvar', { database: 'sample_data', readOnly: true });
		assert.deepStrictEqual(configs, [{ databasePath: 'md:sample_data', readOnly: true, motherduckToken: 'aaa.bbb.ccc' }]);
		await connection.disconnect();
	});

	test('connect rejects a default database with connection options without opening', async () => {
		const driver = createDriver({ env: { motherduck_token: 'aaa.bbb.ccc' } });
		const start = Date.now();
		for (const database of ['mydb?attach_mode=single', 'a#b']) {
			await assert.rejects(async () => driver.connect('envvar', { database }),
				/The default database name cannot contain '\?' or '#'\./);
		}
		assert.deepStrictEqual(configs, []);
		assert.ok(Date.now() - start < 2000);
	});

	test('generateConnectionCode returns no code for a default database with connection options', async () => {
		const driver = createDriver();
		for (const database of ['mydb?attach_mode=single', 'a#b']) {
			for (const languageId of ['python', 'r', 'ggsql']) {
				assert.deepStrictEqual(await driver.generateConnectionCode!('envvar', languageId, { database, readOnly: true }), []);
			}
		}
	});

	test('a profile saved with the old token mechanism fails cleanly', async () => {
		const driver = createDriver({ env: { motherduck_token: 'aaa.bbb.ccc' } });
		await assert.rejects(async () => driver.connect('token', { token: 'aaa.bbb.ccc' }),
			{ message: 'Unknown connection mechanism \'token\'.' });
		assert.deepStrictEqual(await driver.generateConnectionCode!('token', 'python', { token: 'aaa.bbb.ccc' }), []);
		assert.deepStrictEqual(configs, []);
	});

	test('a stored token value is never used when the variable is missing', async () => {
		// Core resolves an old profile's unknown `token` mechanism to `envvar`, so its stored token
		// reaches connect('envvar', ...) as a parameter.
		const driver = createDriver({ env: {} });
		await assert.rejects(async () => driver.connect('envvar', { token: 'aaa.bbb.ccc', database: 'sample_data' }),
			{ message: MISSING_TOKEN_MESSAGE });
		assert.deepStrictEqual(configs, []);
	});

	test('generateConnectionCode ignores a stored token value', async () => {
		const driver = createDriver();
		const params = { token: 'aaa.bbb.ccc', database: 'sample_data', readOnly: true };
		const python = await driver.generateConnectionCode!('envvar', 'python', params);
		assert.ok(python.length > 0);
		assert.ok(python.every(v => !v.code.includes('aaa.bbb.ccc')), python.map(v => v.code).join('\n'));
		const ggsql = await driver.generateConnectionCode!('envvar', 'ggsql', params);
		assert.strictEqual(ggsql[0].code, '-- @connect: duckdb://md:sample_data?access_mode=read_only');
	});
});
