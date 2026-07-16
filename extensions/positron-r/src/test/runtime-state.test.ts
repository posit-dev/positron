/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as assert from 'assert';
import * as testKit from './kit';
import { RSession } from '../session';
import { delay } from '../util';

/**
 * Exercises the improved runtime-state API surface against a real R (ark)
 * session: the synchronous `getRuntimeState()` accessor, the
 * `onDidDisconnect`/`onDidReconnect` events, and the `evaluateCode` `whenBusy`
 * behavior.
 */
suite('Runtime state API', () => {
	let session: RSession;
	let sesDisposable: vscode.Disposable;

	suiteSetup(async () => {
		const [ses, disposable] = await testKit.startR('Suite: Runtime state API');
		session = ses;
		sesDisposable = disposable;
	});

	suiteTeardown(async () => {
		if (sesDisposable) {
			await sesDisposable.dispose();
		}
	});

	test('getRuntimeState is exposed and reports the live state', async () => {
		// Fetch the session through the public API, the same way an external
		// extension would.
		const handle = await positron.runtime.getSession(session.metadata.sessionId);
		assert.ok(handle, 'the session should be retrievable via getSession');
		assert.strictEqual(typeof handle.getRuntimeState, 'function',
			'getRuntimeState should be exposed on the session handle');

		// After startup the session should settle into an idle-ish state.
		await testKit.pollForSuccess(() => {
			const state = handle.getRuntimeState!();
			assert.ok(
				state === positron.RuntimeState.Idle || state === positron.RuntimeState.Ready,
				`expected idle/ready after startup, got '${state}'`);
		});

		// The public handle and the underlying RSession should agree.
		assert.strictEqual(handle.getRuntimeState!(), session.getRuntimeState(),
			'the API handle and the underlying session should report the same state');
	});

	test('getRuntimeState transitions to Busy during execution and back to Idle', async () => {
		const handle = await positron.runtime.getSession(session.metadata.sessionId);
		assert.ok(handle);

		// Ensure we start idle.
		await testKit.pollForSuccess(() => {
			assert.strictEqual(handle.getRuntimeState!(), positron.RuntimeState.Idle);
		});

		// Kick off a long-running computation without awaiting it.
		positron.runtime.executeCode('r', 'Sys.sleep(2)', false, false).then(() => { }, () => { });

		// The state should become Busy.
		await testKit.pollForSuccess(() => {
			assert.strictEqual(handle.getRuntimeState!(), positron.RuntimeState.Busy,
				'session should report Busy while executing');
		});

		// And return to Idle once the computation completes.
		await testKit.pollForSuccess(() => {
			assert.strictEqual(handle.getRuntimeState!(), positron.RuntimeState.Idle,
				'session should return to Idle after executing');
		}, 50, 10000);
	});

	test('onDidDisconnect and onDidReconnect are exposed on the handle', async () => {
		const handle = await positron.runtime.getSession(session.metadata.sessionId);
		assert.ok(handle);

		assert.strictEqual(typeof handle.onDidDisconnect, 'function',
			'onDidDisconnect should be exposed on the session handle');
		assert.strictEqual(typeof handle.onDidReconnect, 'function',
			'onDidReconnect should be exposed on the session handle');

		// Subscribing must not throw, and the events must not fire spuriously
		// while the session is healthy.
		let disconnected = false;
		const sub = handle.onDidDisconnect!(() => { disconnected = true; });
		await delay(200);
		sub.dispose();
		assert.strictEqual(disconnected, false,
			'onDidDisconnect should not fire while the session is connected');
	});

	test('evaluateCode with whenBusy=Reject rejects while the session is busy', async () => {
		const sessionId = session.metadata.sessionId;

		// Ensure the session is idle before we begin.
		await testKit.pollForSuccess(() => {
			assert.strictEqual(session.getRuntimeState(), positron.RuntimeState.Idle);
		});

		// Make the session busy with a long-running computation.
		positron.runtime.executeCode('r', 'Sys.sleep(3)', false, false).then(() => { }, () => { });
		await testKit.pollForSuccess(() => {
			assert.strictEqual(session.getRuntimeState(), positron.RuntimeState.Busy);
		});

		// Reject behavior should throw while busy.
		let rejected = false;
		let message = '';
		try {
			await positron.runtime.evaluateCode('r', '1 + 1', undefined, sessionId,
				positron.RuntimeBusyBehavior.Reject);
		} catch (err: any) {
			rejected = true;
			message = err?.message ?? String(err);
		}
		assert.ok(rejected, 'evaluateCode should reject when the session is busy and whenBusy is Reject');
		assert.ok(/busy/.test(message), `the rejection should mention busy, got: ${message}`);

		// Wait for the session to become idle again before finishing.
		await testKit.pollForSuccess(() => {
			assert.strictEqual(session.getRuntimeState(), positron.RuntimeState.Idle);
		}, 50, 10000);
	});

	test('evaluateCode with whenBusy=Queue resolves once the session is idle', async () => {
		const sessionId = session.metadata.sessionId;

		await testKit.pollForSuccess(() => {
			assert.strictEqual(session.getRuntimeState(), positron.RuntimeState.Idle);
		});

		// Make the session busy briefly.
		positron.runtime.executeCode('r', 'Sys.sleep(1)', false, false).then(() => { }, () => { });
		await testKit.pollForSuccess(() => {
			assert.strictEqual(session.getRuntimeState(), positron.RuntimeState.Busy);
		});

		// Queue an evaluation while busy; it should not reject, and should
		// eventually resolve with the result once the session is idle again.
		const result = await positron.runtime.evaluateCode('r', '2 + 3', undefined, sessionId,
			positron.RuntimeBusyBehavior.Queue);

		// The queued evaluation should have run and produced 5.
		const serialized = JSON.stringify(result);
		assert.ok(/5/.test(serialized), `queued evaluation should return 5, got: ${serialized}`);
	});
});
