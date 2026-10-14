/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as testKit from './kit';
import { ArkLspState } from '../lsp';

suite('Session manager', () => {
	test('should deactivate non-foreground session before activating foreground session', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [_ses1, ses1Disposable, ses1Lsp] = await testKit.startR();
			disposables.push(ses1Disposable);

			assert.strictEqual(ses1Lsp.state, ArkLspState.Running);

			// Array of [sessionNumber, from, to] states
			let states: [number, ArkLspState, ArkLspState][] = [];

			ses1Lsp.onDidChangeState((event) => {
				states.push([1, event.oldState, event.newState]);
			});

			const [_ses2, ses2Disposable, ses2Lsp] = await testKit.startR();

			// Session 1 now offline, and no longer serving anything
			assert.deepStrictEqual(states.pop(), [1, ArkLspState.Running, ArkLspState.Stopped]);
			assert.strictEqual(ses1Lsp.activationDisposableCount, 0);

			// Session 2 now online
			assert.strictEqual(ses2Lsp.state, ArkLspState.Running);

			ses2Lsp.onDidChangeState((event) => {
				states.push([2, event.oldState, event.newState]);
			});

			// Delete session 2 to put session 1 back to foreground
			await ses2Disposable.dispose();

			// Session 2 now offline
			assert.deepStrictEqual(states.pop(), [2, ArkLspState.Running, ArkLspState.Stopped]);

			// The LSP of the first session eventually goes back online, with its
			// registrations restored
			await testKit.pollForSuccess(() => {
				assert.strictEqual(ses1Lsp.state, ArkLspState.Running);
			});
			assert.notStrictEqual(ses1Lsp.activationDisposableCount, 0);
		});
	});

	test('should stop serving when the client stops without deactivation', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [_ses, sesDisposable, sesLsp] = await testKit.startR();
			disposables.push(sesDisposable);

			assert.strictEqual(sesLsp.state, ArkLspState.Running);
			assert.notStrictEqual(sesLsp.activationDisposableCount, 0);

			// Stop the client the way a server crash does: the session layer
			// never calls `deactivate()` on a wrapper that is no longer running.
			sesLsp.stopClientForTesting();

			await testKit.pollForSuccess(() => {
				assert.strictEqual(sesLsp.state, ArkLspState.Stopped);
			});
			assert.strictEqual(sesLsp.activationDisposableCount, 0);
		});
	});
});
