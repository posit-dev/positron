/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { DuckDBWorkerClient } from 'positron-data-explorer-duckdb';

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
});
