/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OdbcWorkerClient } from '../odbcWorkerClient.js';

/**
 * A stand-in for the real worker, with no ODBC and no native binding in it. It answers a `pid`
 * query with its own process id -- which is how a test gets hold of the child in order to kill it
 * -- and deliberately answers nothing else, so a request can be left in flight while the process
 * dies underneath it.
 *
 * Written to a temp file and passed to the client's `_workerPath`, which exists for exactly this:
 * the crash path cannot be exercised against the real worker without a driver that faults.
 */
const STUB_WORKER = `
process.on('message', (request) => {
	if (request.kind === 'query' && request.sql === 'pid') {
		process.send({ kind: 'result', id: request.id, rows: [{ pid: process.pid }] });
	}
	// Anything else is swallowed, leaving the host waiting on it forever.
});
`;

/** The sql the stub never answers, used whenever a test needs a request still in flight. */
const UNANSWERED = 'never answered';

suite('OdbcWorkerClient crash recovery', () => {
	let stubDir: string;
	let stubPath: string;
	const clients: OdbcWorkerClient[] = [];

	suiteSetup(() => {
		stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odbc-worker-stub-'));
		stubPath = path.join(stubDir, 'stubWorker.js');
		fs.writeFileSync(stubPath, STUB_WORKER);
	});

	suiteTeardown(() => {
		fs.rmSync(stubDir, { recursive: true, force: true });
	});

	// Disposing kills the worker, so a test that leaves one running does not leak a process.
	teardown(() => {
		while (clients.length > 0) {
			clients.pop()!.dispose();
		}
	});

	/**
	 * Starts a client on the stub worker and returns it along with the process id of the child it
	 * forked. Waiting on a real answer means the worker is up and talking before a test kills it.
	 */
	async function startClient(): Promise<{ client: OdbcWorkerClient; pid: number }> {
		const client = new OdbcWorkerClient('DSN=Stub', stubPath);
		clients.push(client);

		const rows = await client.runQuery('pid');
		const pid = Number(rows[0]?.pid);
		assert.ok(pid > 0, 'the stub worker should have reported its process id');

		return { client, pid };
	}

	test('a worker that dies rejects the request in flight and reports the crash', async () => {
		const { client, pid } = await startClient();

		let crashes = 0;
		client.onDidCrash(() => crashes++);

		const inFlight = client.runQuery(UNANSWERED);
		process.kill(pid, 'SIGKILL');

		// A native abort inside a vendor driver looks like this from the host's side: the child is
		// simply gone. The rejection is the only thing standing between that and a caller that
		// hangs forever, and the event is how the connection learns to tear its state down.
		await assert.rejects(inFlight, /terminated unexpectedly/);
		assert.strictEqual(crashes, 1, 'onDidCrash should have fired once');
		assert.strictEqual(client.isAlive, false);
	});

	test('the next request respawns the worker after a crash', async () => {
		const { client, pid } = await startClient();

		const inFlight = client.runQuery(UNANSWERED);
		process.kill(pid, 'SIGKILL');
		await assert.rejects(inFlight);

		// Recovery is transparent: the caller simply makes another request and gets a live worker,
		// running in a new process. Nothing has to be replayed to reconnect, because the worker
		// opens its ODBC connection on the first request it is given.
		const rows = await client.runQuery('pid');
		const respawnedPid = Number(rows[0]?.pid);
		assert.ok(respawnedPid > 0, 'the respawned worker should have reported its process id');
		assert.notStrictEqual(respawnedPid, pid, 'the respawned worker should be a new process');
		assert.strictEqual(client.isAlive, true);
	});
});
