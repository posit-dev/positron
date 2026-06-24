/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { isReconnectTarget, sharesApplicationLifetime } from '../KallichoreAdapterApi';

suite('sharesApplicationLifetime', () => {
	test('desktop with immediate shutdown shares the application lifetime', () => {
		assert.strictEqual(
			sharesApplicationLifetime(vscode.UIKind.Desktop, 'immediately'),
			true,
		);
	});

	test('desktop with a detached shutdown timeout outlives the application', () => {
		// Any non-default timeout (hours, 'when idle', 'indefinitely') runs the
		// server detached so it outlives the application: 'when idle' to let
		// in-flight computations finish, the rest so they can be reconnected to
		// on the next launch.
		for (const timeout of ['when idle', '1', '2', 'indefinitely']) {
			assert.strictEqual(
				sharesApplicationLifetime(vscode.UIKind.Desktop, timeout),
				false,
				`expected '${timeout}' to outlive the application`,
			);
		}
	});

	test('web servers outlive the application regardless of shutdown timeout', () => {
		assert.strictEqual(
			sharesApplicationLifetime(vscode.UIKind.Web, 'immediately'),
			false,
		);
	});
});

suite('isReconnectTarget', () => {
	test('desktop persists state only for timeouts meant for reconnection', () => {
		// 'immediately' and 'when idle' are never reconnected to across an
		// application exit, so their state stays ephemeral. A fixed number of
		// hours or 'indefinitely' keeps the server alive for reconnection, so
		// its state must persist.
		const expectations: Array<[string, boolean]> = [
			['immediately', false],
			['when idle', false],
			['1', true],
			['2', true],
			['indefinitely', true],
		];
		for (const [timeout, expected] of expectations) {
			assert.strictEqual(
				isReconnectTarget(vscode.UIKind.Desktop, timeout),
				expected,
				`expected isReconnectTarget('${timeout}') to be ${expected}`,
			);
		}
	});

	test('web servers are always reconnect targets', () => {
		assert.strictEqual(
			isReconnectTarget(vscode.UIKind.Web, 'immediately'),
			true,
		);
	});
});
