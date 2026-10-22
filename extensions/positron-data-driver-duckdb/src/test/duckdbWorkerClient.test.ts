/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { DuckDBWorkerClient, duckDBWorkerPool } from 'positron-data-explorer-duckdb';

suite('DuckDB worker isolation', () => {
	// A stub worker that speaks the IPC protocol, so we can exercise crash
	// recovery without depending on the native binding or a real out-of-memory
	// condition. It crashes hard on a sentinel query and otherwise returns a
	// trivial one-row result.
	const STUB_WORKER = `
		process.on('message', (req) => {
			if (req.sql === 'CRASH') { process.exit(1); return; }
			process.send({ kind: 'result', id: req.id, rows: [{ x: 1 }] });
		});
	`;

	test('survives a worker crash, rejects the in-flight query, and respawns', async () => {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'duckdb-stub-worker-'));
		const stubPath = path.join(dir, 'stubWorker.js');
		await fs.promises.writeFile(stubPath, STUB_WORKER);

		const client = new DuckDBWorkerClient({ databasePath: ':memory:', readOnly: false }, stubPath);
		let crashCount = 0;
		const crashListener = client.onDidCrash(() => { crashCount++; });
		try {
			// Normal query round-trips through the worker.
			assert.deepStrictEqual(await client.runQuery('SELECT 1'), [{ x: 1 }]);

			// A crashing query rejects (rather than hanging) and fires onDidCrash.
			await assert.rejects(client.runQuery('CRASH'), /terminated unexpectedly/);
			assert.strictEqual(crashCount, 1, 'onDidCrash should fire exactly once');

			// The next query transparently respawns the worker and succeeds.
			assert.deepStrictEqual(await client.runQuery('SELECT 1'), [{ x: 1 }]);
		} finally {
			crashListener.dispose();
			client.dispose();
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	});
	// A stub that reports what the worker process was given, so we can check which channel the
	// MotherDuck token travels through.
	const ECHO_WORKER = `
		process.on('message', (req) => {
			process.send({ kind: 'result', id: req.id, rows: [{ argv: process.argv[2], env: process.env.POSITRON_DUCKDB_MOTHERDUCK_TOKEN, lower: process.env.motherduck_token, upper: process.env.MOTHERDUCK_TOKEN }] });
		});
	`;

	async function echoFromWorker(config: { databasePath: string; readOnly: boolean; motherduckToken?: string }): Promise<{ argv: string; env: string | undefined; lower: string | undefined; upper: string | undefined }> {
		const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'duckdb-echo-worker-'));
		const stubPath = path.join(dir, 'echoWorker.js');
		await fs.promises.writeFile(stubPath, ECHO_WORKER);
		const client = new DuckDBWorkerClient(config, stubPath);
		try {
			const rows = await client.runQuery('SELECT 1');
			return rows[0] as { argv: string; env: string | undefined; lower: string | undefined; upper: string | undefined };
		} finally {
			client.dispose();
			await fs.promises.rm(dir, { recursive: true, force: true });
		}
	}

	test('motherduck token reaches the worker through the environment, not argv', async () => {
		const { argv, env } = await echoFromWorker({ databasePath: ':memory:', readOnly: false, motherduckToken: 'tok.en.123' });
		assert.ok(!argv.includes('tok.en.123'), 'token must not appear in argv');
		assert.ok(!('motherduckToken' in JSON.parse(argv)), 'config in argv must not have a motherduckToken key');
		assert.strictEqual(env, 'tok.en.123');
	});

	test('no token means no motherduck env var', async () => {
		const name = 'POSITRON_DUCKDB_MOTHERDUCK_TOKEN';
		const saved = process.env[name];
		process.env[name] = 'inherited-token';
		try {
			const { env } = await echoFromWorker({ databasePath: ':memory:', readOnly: false });
			assert.strictEqual(env, undefined);
		} finally {
			if (saved === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = saved;
			}
		}
	});

	async function withPlainTokenEnv<T>(fn: () => Promise<T>): Promise<T> {
		const names = ['motherduck_token', 'MOTHERDUCK_TOKEN'];
		const saved = names.map(n => process.env[n]);
		names.forEach(n => { process.env[n] = `inherited-${n}`; });
		try {
			return await fn();
		} finally {
			names.forEach((n, i) => {
				if (saved[i] === undefined) {
					delete process.env[n];
				} else {
					process.env[n] = saved[i];
				}
			});
		}
	}

	test('with a token, inherited plain motherduck_token variables are scrubbed', async () => {
		const result = await withPlainTokenEnv(() => echoFromWorker({ databasePath: ':memory:', readOnly: false, motherduckToken: 'tok.en.123' }));
		assert.deepStrictEqual({ lower: result.lower, upper: result.upper, env: result.env }, { lower: undefined, upper: undefined, env: 'tok.en.123' });
	});

	test('without a token, an inherited plain motherduck_token reaches the worker unchanged', async () => {
		const result = await withPlainTokenEnv(() => echoFromWorker({ databasePath: ':memory:', readOnly: false }));
		assert.strictEqual(result.lower, 'inherited-motherduck_token');
	});

	test('md: path without a token fails fast without opening', async function () {
		this.timeout(5000);
		for (const databasePath of ['md:', 'MD:', 'motherduck:']) {
			for (const motherduckToken of [undefined, '   ']) {
				const client = new DuckDBWorkerClient({ databasePath, readOnly: true, motherduckToken });
				try {
					await assert.rejects(client.runQuery('SELECT 1'), /A MotherDuck access token is required\./);
				} finally {
					client.dispose();
				}
			}
		}
	});

	test('the worker pool refuses a MotherDuck config', () => {
		assert.throws(
			() => duckDBWorkerPool.acquire({ databasePath: 'md:', readOnly: true, motherduckToken: 'tok.en.123' }),
			/MotherDuck workers cannot be pooled/);
	});
});
