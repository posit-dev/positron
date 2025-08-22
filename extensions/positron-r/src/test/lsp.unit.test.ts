/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup'

import * as assert from 'assert';
import * as testKit from './kit';
import { State } from 'vscode-languageclient/node';

suite('Session manager', () => {
	test('should deactivate non-foreground session before activating foreground session', async () => {
		await testKit.withDisposables(async (disposables) => {
			const [_ses1, ses1Disposable, ses1Lsp] = await testKit.startR();
			disposables.push(ses1Disposable);

			assert.strictEqual(ses1Lsp.client!.state, State.Running);

			// Array of [sessionNumber, from, to] states
			let states: [number, State, State][] = [];

			ses1Lsp.client!.onDidChangeState((event) => {
				states.push([1, event.oldState, event.newState]);
			});

			const [_ses2, ses2Disposable, ses2Lsp] = await testKit.startR();

			// Session 1 now offline
			assert.deepStrictEqual(states.pop(), [1, State.Running, State.Stopped]);

			// Session 2 now online
			assert.strictEqual(ses2Lsp.client!.state, State.Running);

			ses2Lsp.client!.onDidChangeState((event) => {
				states.push([2, event.oldState, event.newState]);
			});

			// Delete session 2 to put session 1 back to foreground
			await ses2Disposable.dispose();

			// Session 2 now offline
			assert.deepStrictEqual(states.pop(), [2, State.Running, State.Stopped]);

			// The LSP of the first session eventually goes back online
			testKit.pollForSuccess(() => {
				assert.strictEqual(ses1Lsp.client!.state, State.Running);
			})

			// We would expect the following but currently we start the LSP client
			// anew on each activation, so the event handler is no longer active.
			// This test would allow us to robustly check for event ordering.

			// assert.deepStrictEqual(states.pop(), [1, State.Stopped, State.Running]);
		});
	});
});
