/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { generateSuggestion } from '../suggestions.js';
import * as clientModule from '../client.js';
import * as modelModule from '../model.js';
import * as variablesModule from '../variables.js';
import * as feedbackModule from '../feedback.js';
import { makeFakeClientManager, makeLLMConfig, makeInlineEditResult, type FakeClientManager } from './testUtils.js';

suite('suggestions / generateSuggestion', () => {
	let fake: FakeClientManager;
	let getClientManager: sinon.SinonStub;
	let getLLMConfiguration: sinon.SinonStub;

	setup(() => {
		fake = makeFakeClientManager();
		getClientManager = sinon.stub(clientModule, 'getLanguageClientManager').returns(fake.manager);
		getLLMConfiguration = sinon.stub(modelModule, 'getLLMConfiguration').resolves(makeLLMConfig());
		sinon.stub(variablesModule, 'getSessionVariables').resolves([]);
		// Deterministic enclosing-block lookup (no real language server).
		sinon.stub(vscode.commands, 'executeCommand').resolves([]);
	});

	teardown(() => {
		sinon.restore();
	});

	async function openDoc(content: string, language = 'python'): Promise<vscode.TextDocument> {
		return vscode.workspace.openTextDocument({ language, content });
	}

	test('ghost-text insert: appends text at the cursor without an inline edit', async () => {
		const doc = await openDoc('x = ');
		const position = new vscode.Position(0, 4);
		fake.sendRequest.resolves(makeInlineEditResult({
			text: '42',
			range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
			correlationId: 'corr-1',
		}));

		const item = await generateSuggestion(doc, position);

		assert.ok(item, 'expected a suggestion item');
		assert.strictEqual(item!.insertText, '42');
		assert.ok(item!.range);
		assert.ok(item!.range!.start.isEqual(position));
		assert.ok(item!.range!.end.isEqual(position));
		assert.strictEqual(item!.isInlineEdit, undefined);
		assert.strictEqual(item!.correlationId, 'corr-1');
	});

	test('inline edit: a divergent replacement is flagged as an inline edit', async () => {
		const doc = await openDoc('def add(a, b):\n    return a - b');
		const position = new vscode.Position(1, 16);
		fake.sendRequest.resolves(makeInlineEditResult({
			text: '    return a + b',
			range: { start: { line: 1, character: 0 }, end: { line: 1, character: 16 } },
			correlationId: 'corr-2',
		}));

		const item = await generateSuggestion(doc, position);

		assert.ok(item, 'expected a suggestion item');
		assert.strictEqual(item!.insertText, '    return a + b');
		assert.strictEqual(item!.isInlineEdit, true);
		assert.strictEqual(item!.showInlineEditMenu, true);
		assert.ok(item!.showRange, 'expected a showRange');
		assert.strictEqual(item!.action?.command, 'next-edit-suggestions.learnMore');
		assert.strictEqual(item!.correlationId, 'corr-2');
	});

	test('strips a trailing markdown fence from the suggestion text', async () => {
		const doc = await openDoc('x = ');
		const position = new vscode.Position(0, 4);
		fake.sendRequest.resolves(makeInlineEditResult({
			text: 'foo\n```',
			range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
			correlationId: 'corr-3',
		}));

		const item = await generateSuggestion(doc, position);

		assert.ok(item);
		assert.strictEqual(item!.insertText, 'foo');
	});

	test('empty suggestion text reports "filtered" feedback and returns null', async () => {
		const sendFeedback = sinon.stub(feedbackModule, 'sendFeedback');
		const doc = await openDoc('x = ');
		const position = new vscode.Position(0, 4);
		fake.sendRequest.resolves(makeInlineEditResult({
			text: '   ',
			range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
			correlationId: 'corr-4',
		}));

		const item = await generateSuggestion(doc, position);

		assert.strictEqual(item, null);
		assert.ok(sendFeedback.calledOnceWithExactly('corr-4', 'filtered'));
	});

	test('sends a well-formed inlineEdit request to the language server', async () => {
		const doc = await openDoc('x = ');
		const position = new vscode.Position(0, 4);
		fake.sendRequest.resolves(makeInlineEditResult({
			text: '42',
			range: { start: { line: 0, character: 4 }, end: { line: 0, character: 4 } },
		}));

		await generateSuggestion(doc, position);

		assert.ok(fake.sendRequest.calledOnce);
		const params = fake.sendRequest.firstCall.args[1];
		assert.strictEqual(params.textDocument.uri, doc.uri.toString());
		assert.deepStrictEqual(params.position, { line: 0, character: 4 });
		assert.ok(params.selection.excerpt.includes('<|user_cursor_is_here|>'));
		assert.ok(params.selection.excerpt.includes('<|editable_region_start|>'));
		assert.ok(params.selection.excerpt.includes('<|editable_region_end|>'));
	});

	test('returns null when no language client is running', async () => {
		getClientManager.returns(undefined);
		const doc = await openDoc('x = ');

		const item = await generateSuggestion(doc, new vscode.Position(0, 4));

		assert.strictEqual(item, null);
		assert.ok(fake.sendRequest.notCalled);
	});

	test('returns null without a request when no LLM configuration is available', async () => {
		getLLMConfiguration.resolves(null);
		const doc = await openDoc('x = ');

		const item = await generateSuggestion(doc, new vscode.Position(0, 4));

		assert.strictEqual(item, null);
		assert.ok(fake.sendRequest.notCalled);
	});
});
