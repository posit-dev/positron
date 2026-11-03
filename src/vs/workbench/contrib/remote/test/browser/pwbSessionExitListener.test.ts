/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConnectionGainEvent, ConnectionLostEvent, PersistentConnectionEvent, ReconnectionRunningEvent } from '../../../../../platform/remote/common/remoteAgentConnection.js';
import { PwbSessionExitWatcher } from '../../browser/pwbSessionExitListener.js';

suite('PWB session exit watcher', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		const onDidStateChange = ds.add(new Emitter<PersistentConnectionEvent>());
		let stops = 0;
		const watcher = ds.add(new PwbSessionExitWatcher(onDidStateChange.event, () => stops++));
		return {
			watcher,
			lose: () => onDidStateChange.fire(new ConnectionLostEvent('token', 0)),
			reconnecting: () => onDidStateChange.fire(new ReconnectionRunningEvent('token', 0, 1)),
			gain: () => onDidStateChange.fire(new ConnectionGainEvent('token', 0, 1)),
			stops: () => stops,
		};
	}

	test('stops when the connection is lost and then the session is reported exited', () => {
		const t = setup();
		t.lose();
		t.watcher.setSessionExited(true);
		assert.strictEqual(t.stops(), 1);
	});

	test('stops when the session exit is reported before the connection drops', () => {
		const t = setup();
		t.watcher.setSessionExited(true);
		assert.strictEqual(t.stops(), 0);
		t.lose();
		assert.strictEqual(t.stops(), 1);
	});

	test('does not stop a connected tab or a session that has not exited', () => {
		const t = setup();
		t.watcher.setSessionExited(true);
		t.gain();
		assert.strictEqual(t.stops(), 0, 'connection still up');
		t.watcher.setSessionExited(false);
		t.lose();
		t.watcher.setSessionExited(false);
		assert.strictEqual(t.stops(), 0, 'session not exited');
	});

	test('stops on a reconnect event when ConnectionLost fired before the watcher subscribed', () => {
		const t = setup();
		t.watcher.setSessionExited(true);
		assert.strictEqual(t.stops(), 0);
		t.reconnecting();
		assert.strictEqual(t.stops(), 1);
	});

	test('stops only once', () => {
		const t = setup();
		t.lose();
		t.watcher.setSessionExited(true);
		t.watcher.setSessionExited(true);
		t.lose();
		assert.strictEqual(t.stops(), 1);
	});
});
