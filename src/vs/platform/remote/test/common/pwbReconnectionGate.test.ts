/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { createCancelablePromise } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { Emitter } from '../../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IReconnectionGate, PWB_LOGGED_OUT_RECONNECT_WAIT_SECONDS, pwbCancelWaitOnLogin, pwbCreateAttemptCancellation, pwbReconnectWaitSeconds } from '../../common/remoteAgentConnection.js';

suite('PWB login-aware reconnection backoff', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	function gate(isLoggedIn: boolean) {
		const onDidLogin = ds.add(new Emitter<void>());
		const g: IReconnectionGate = { isLoggedIn, onDidLogin: onDidLogin.event };
		return { g, onDidLogin };
	}

	test('keeps the normal schedule without a gate or while logged in', () => {
		assert.strictEqual(pwbReconnectWaitSeconds(undefined, 5), 5);
		assert.strictEqual(pwbReconnectWaitSeconds(gate(true).g, 30), 30);
	});

	test('waits 10 minutes while logged out, even before the first attempt', () => {
		assert.strictEqual(pwbReconnectWaitSeconds(gate(false).g, 0), PWB_LOGGED_OUT_RECONNECT_WAIT_SECONDS);
	});

	test('a login cancels the pending wait', async () => {
		const { g, onDidLogin } = gate(false);
		const wait = createCancelablePromise(() => new Promise<void>(() => { }));
		const listener = pwbCancelWaitOnLogin(g, wait);
		onDidLogin.fire();
		await assert.rejects(wait, (err: unknown) => isCancellationError(err));
		listener.dispose();
	});
});

suite('PWB reconnect attempt cancellation', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	test('is cancelled when the attempt times out', () => {
		const timeout = ds.add(new CancellationTokenSource());
		const attempt = ds.add(pwbCreateAttemptCancellation(timeout.token, CancellationToken.None));
		assert.strictEqual(attempt.token.isCancellationRequested, false);
		timeout.cancel();
		assert.strictEqual(attempt.token.isCancellationRequested, true);
	});

	test('is cancelled when the connection permanently fails', () => {
		const failure = ds.add(new CancellationTokenSource());
		const attempt = ds.add(pwbCreateAttemptCancellation(CancellationToken.None, failure.token));
		assert.strictEqual(attempt.token.isCancellationRequested, false);
		failure.cancel();
		assert.strictEqual(attempt.token.isCancellationRequested, true);
	});

	test('a finished attempt leaves no listener on the permanent-failure token', () => {
		const failure = ds.add(new CancellationTokenSource());
		const attempt = pwbCreateAttemptCancellation(CancellationToken.None, failure.token);
		const token = attempt.token;
		attempt.dispose();
		failure.cancel();
		assert.strictEqual(token.isCancellationRequested, false);
	});
});
