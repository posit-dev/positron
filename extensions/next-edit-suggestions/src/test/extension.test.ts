/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { activate } from '../extension.js';
import * as configModule from '../config.js';
import * as modelModule from '../model.js';
import * as feedbackModule from '../feedback.js';
import * as suggestionsModule from '../suggestions.js';

const noopDisposable: vscode.Disposable = { dispose() { } };

suite('extension / inline completion provider', () => {
	let provider: vscode.InlineCompletionItemProvider;
	let sendFeedback: sinon.SinonStub;

	setup(() => {
		// Isolate activate() from global state: capture the registered provider and
		// neutralize the other registrations so repeated activations don't conflict.
		sinon.stub(vscode.commands, 'registerCommand').returns(noopDisposable);
		sinon.stub(vscode.authentication, 'onDidChangeSessions').returns(noopDisposable);
		sinon.stub(vscode.workspace, 'onDidChangeConfiguration').returns(noopDisposable);
		// No auth token => the real language server is never started.
		sinon.stub(modelModule, 'getLLMConfiguration').resolves(null);
		sendFeedback = sinon.stub(feedbackModule, 'sendFeedback');

		const register = sinon
			.stub(vscode.languages, 'registerInlineCompletionItemProvider')
			.callsFake((_selector, p) => {
				provider = p as vscode.InlineCompletionItemProvider;
				return noopDisposable;
			});

		const context = {
			subscriptions: [],
			asAbsolutePath: (p: string) => p,
		} as unknown as vscode.ExtensionContext;

		activate(context);
		assert.ok(register.calledOnce, 'expected an inline completion provider to be registered');
	});

	teardown(() => {
		sinon.restore();
	});

	suite('telemetry on end of lifetime', () => {
		const item = { correlationId: 'id' } as vscode.InlineCompletionItem;

		function endOfLife(reason: vscode.InlineCompletionEndOfLifeReason): void {
			provider.handleEndOfLifetime!(item, reason);
		}

		test('accepted suggestion reports "accepted"', () => {
			endOfLife({ kind: vscode.InlineCompletionEndOfLifeReasonKind.Accepted } as vscode.InlineCompletionEndOfLifeReason);
			assert.ok(sendFeedback.calledOnceWithExactly('id', 'accepted'));
		});

		test('rejected suggestion reports "rejected"', () => {
			endOfLife({ kind: vscode.InlineCompletionEndOfLifeReasonKind.Rejected } as vscode.InlineCompletionEndOfLifeReason);
			assert.ok(sendFeedback.calledOnceWithExactly('id', 'rejected'));
		});

		test('ignored suggestion reports "ignored"', () => {
			endOfLife({ kind: vscode.InlineCompletionEndOfLifeReasonKind.Ignored } as vscode.InlineCompletionEndOfLifeReason);
			assert.ok(sendFeedback.calledOnceWithExactly('id', 'ignored'));
		});

		test('a suggestion superseded by a newer request reports nothing', () => {
			endOfLife({
				kind: vscode.InlineCompletionEndOfLifeReasonKind.Ignored,
				supersededBy: { correlationId: 'newer' } as vscode.InlineCompletionItem,
			} as vscode.InlineCompletionEndOfLifeReason);
			assert.ok(sendFeedback.notCalled);
		});
	});

	suite('provideInlineCompletionItems', () => {
		const position = new vscode.Position(0, 0);
		const inlineContext = {} as vscode.InlineCompletionContext;

		function token(): vscode.CancellationToken {
			return new vscode.CancellationTokenSource().token;
		}

		test('returns an empty list and does not query when completions are disabled', async () => {
			sinon.stub(configModule, 'isCompletionEnabled').returns(false);
			const generate = sinon.stub(suggestionsModule, 'generateSuggestion');

			const result = await provider.provideInlineCompletionItems(
				{} as vscode.TextDocument, position, inlineContext, token());

			assert.strictEqual((result as vscode.InlineCompletionList).items.length, 0);
			assert.ok(generate.notCalled);
		});

		test('wraps a generated suggestion in a forward-stable list', async () => {
			sinon.stub(configModule, 'isCompletionEnabled').returns(true);
			const generated = new vscode.InlineCompletionItem('hello');
			sinon.stub(suggestionsModule, 'generateSuggestion').resolves(generated);

			const result = await provider.provideInlineCompletionItems(
				{} as vscode.TextDocument, position, inlineContext, token()) as vscode.InlineCompletionList;

			assert.strictEqual(result.items.length, 1);
			assert.strictEqual(result.items[0], generated);
			assert.strictEqual(result.enableForwardStability, true);
		});
	});
});
