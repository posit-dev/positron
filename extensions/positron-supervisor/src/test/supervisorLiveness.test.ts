/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KallichoreInstances } from '../KallichoreInstances';

// The liveness helpers are private; exercise them through a structural cast so
// the tests track the production code path instead of a copy of it.
const Liveness = KallichoreInstances as unknown as {
	isSupervisorAlive(pid: number, socketPath?: string): boolean;
};

suite('KallichoreInstances supervisor liveness', () => {
	let scratchDir: string;

	setup(() => {
		scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-liveness-'));
	});

	teardown(() => {
		fs.rmSync(scratchDir, { recursive: true, force: true });
	});

	test('nonexistent PID is reported dead', () => {
		// 2**30 exceeds any real PID, so kill() must fail with ESRCH, never EPERM.
		assert.strictEqual(Liveness.isSupervisorAlive(2 ** 30), false);
	});

	test('current process without a socket path is only trusted off Linux', () => {
		// The test runner is not the kcserver binary, so on Linux the /proc
		// fingerprint must reject it regardless of transport.
		const expected = process.platform !== 'linux';
		assert.strictEqual(Liveness.isSupervisorAlive(process.pid), expected);
	});

	test('current process with a missing socket path is reported dead', () => {
		const missing = path.join(scratchDir, 'kc-424242.sock');
		assert.strictEqual(Liveness.isSupervisorAlive(process.pid, missing), false);
	});

	test('current process holding an unrelated socket is only trusted off Linux', () => {
		const stub = path.join(scratchDir, 'kc-424243.sock');
		fs.writeFileSync(stub, '');
		const expected = process.platform !== 'linux';
		assert.strictEqual(Liveness.isSupervisorAlive(process.pid, stub), expected);
	});
});
