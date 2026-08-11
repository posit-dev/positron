/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { AhpSnapshotRecorder } from './ahpSnapshot.js';

// Positron's extension-host test container runs as the OS user `root`, which collides
// with the agent host protocol's reserved `root/` channel prefix (e.g. `root/sessionAdded`).
// These tests pin the username normalization so the protocol prefix survives while genuine
// owner tokens are still normalized to `${user}`.
suite('AhpSnapshotRecorder username normalization', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('keeps the reserved root/ protocol channel intact when the OS user is root', () => {
		const recorder = new AhpSnapshotRecorder();
		recorder.setNormalization({ workingDirectory: '/tmp/ahp-work', homeDirectory: '/root', userName: 'root' });
		recorder.record('s2c', { jsonrpc: '2.0', method: 'root/sessionAdded' });

		const snapshot = recorder.serialize();

		assert.ok(snapshot.includes('root/sessionAdded'), `expected literal root/ channel, got:\n${snapshot}`);
		assert.ok(!snapshot.includes('${user}/sessionAdded'), `root/ channel was corrupted to \${user}/:\n${snapshot}`);
	});

	test('still normalizes a bare root owner token to ${user}', () => {
		const recorder = new AhpSnapshotRecorder();
		recorder.setNormalization({ workingDirectory: '/tmp/ahp-work', homeDirectory: '/root', userName: 'root' });
		recorder.record('s2c', { jsonrpc: '2.0', id: 1, error: { code: -1, message: '-rw-r--r-- 1 root  staff  12 file.txt' } });

		const snapshot = recorder.serialize();

		assert.ok(snapshot.includes('${user}  staff'), `bare owner token should normalize to \${user}, got:\n${snapshot}`);
		assert.ok(!/\broot\s+staff/.test(snapshot), `bare owner token was left as root:\n${snapshot}`);
	});
});
