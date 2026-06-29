/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { CompletionBusyState } from '../completionBusyState.js';

suite('completionBusyState / CompletionBusyState', () => {
	let executeCommand: sinon.SinonStub;

	setup(() => {
		executeCommand = sinon.stub(vscode.commands, 'executeCommand').resolves(undefined);
	});

	teardown(() => {
		sinon.restore();
	});

	// The most recent value pushed to the `nextEditSuggestions.busy` context key.
	function busy(): boolean | undefined {
		const calls = executeCommand.getCalls().filter(c => c.args[0] === 'setContext' && c.args[1] === 'nextEditSuggestions.busy');
		return calls.length ? calls[calls.length - 1].args[2] as boolean : undefined;
	}

	test('marks busy while a single request is in flight, then idle', async () => {
		const state = new CompletionBusyState();
		let resolve!: (value: string) => void;
		const tracked = state.track(() => new Promise<string>(r => { resolve = r; }));

		assert.strictEqual(busy(), true);

		resolve('done');
		assert.strictEqual(await tracked, 'done');
		assert.strictEqual(busy(), false);
	});

	test('stays busy until the last of several overlapping requests settles', async () => {
		const state = new CompletionBusyState();
		let resolveA!: () => void;
		let resolveB!: () => void;
		const a = state.track(() => new Promise<void>(r => { resolveA = r; }));
		const b = state.track(() => new Promise<void>(r => { resolveB = r; }));

		assert.strictEqual(busy(), true);

		resolveA();
		await a;
		assert.strictEqual(busy(), true);

		resolveB();
		await b;
		assert.strictEqual(busy(), false);
	});

	test('clears busy and propagates the error when a request rejects', async () => {
		const state = new CompletionBusyState();
		let reject!: (reason: Error) => void;
		const tracked = state.track(() => new Promise<string>((_resolve, rej) => { reject = rej; }));

		assert.strictEqual(busy(), true);

		reject(new Error('boom'));
		await assert.rejects(tracked, /boom/);
		assert.strictEqual(busy(), false);
	});
});
