/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { URI } from 'vs/base/common/uri';
import { assertSnapshot } from 'vs/base/test/common/snapshot';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { OffsetRange } from 'vs/editor/common/core/offsetRange';
import { Range } from 'vs/editor/common/core/range';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ChatAgentLocation, ChatAgentService, IChatAgentService } from 'vs/workbench/contrib/chat/common/chatAgents';
import { ChatModel, Response } from 'vs/workbench/contrib/chat/common/chatModel';
import { ChatRequestTextPart } from 'vs/workbench/contrib/chat/common/chatParserTypes';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { TestExtensionService, TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

suite('ChatModel', () => {
	const testDisposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;

	setup(async () => {
		instantiationService = testDisposables.add(new TestInstantiationService());
		instantiationService.stub(IStorageService, testDisposables.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(IChatAgentService, instantiationService.createInstance(ChatAgentService));
	});

	test('Waits for initialization', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		let hasInitialized = false;
		model.waitForInitialization().then(() => {
			hasInitialized = true;
		});

		await timeout(0);
		assert.strictEqual(hasInitialized, false);

		model.startInitialize();
		model.initialize(undefined);
		await timeout(0);
		assert.strictEqual(hasInitialized, true);
	});

	test('must call startInitialize before initialize', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		let hasInitialized = false;
		model.waitForInitialization().then(() => {
			hasInitialized = true;
		});

		await timeout(0);
		assert.strictEqual(hasInitialized, false);

		assert.throws(() => model.initialize(undefined));
		assert.strictEqual(hasInitialized, false);
	});

	test('deinitialize/reinitialize', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		let hasInitialized = false;
		model.waitForInitialization().then(() => {
			hasInitialized = true;
		});

		model.startInitialize();
		model.initialize(undefined);
		await timeout(0);
		assert.strictEqual(hasInitialized, true);

		model.deinitialize();
		let hasInitialized2 = false;
		model.waitForInitialization().then(() => {
			hasInitialized2 = true;
		});

		model.startInitialize();
		model.initialize(undefined);
		await timeout(0);
		assert.strictEqual(hasInitialized2, true);
	});

	test('cannot initialize twice', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		model.startInitialize();
		model.initialize(undefined);
		assert.throws(() => model.initialize(undefined));
	});

	test('Initialization fails when model is disposed', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));
		model.dispose();

		assert.throws(() => model.initialize(undefined));
	});

	test('removeRequest', async () => {
		const model = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		model.startInitialize();
		model.initialize(undefined);
		const text = 'hello';
		model.addRequest({ text, parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, text.length, 1, text.length), text)] }, { variables: [] }, 0);
		const requests = model.getRequests();
		assert.strictEqual(requests.length, 1);

		model.removeRequest(requests[0].id);
		assert.strictEqual(model.getRequests().length, 0);
	});

	test('adoptRequest', async function () {
		const model1 = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Editor));
		const model2 = testDisposables.add(instantiationService.createInstance(ChatModel, undefined, ChatAgentLocation.Panel));

		model1.startInitialize();
		model1.initialize(undefined);

		model2.startInitialize();
		model2.initialize(undefined);

		const text = 'hello';
		const request1 = model1.addRequest({ text, parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, text.length, 1, text.length), text)] }, { variables: [] }, 0);

		assert.strictEqual(model1.getRequests().length, 1);
		assert.strictEqual(model2.getRequests().length, 0);
		assert.ok(request1.session === model1);
		assert.ok(request1.response?.session === model1);

		model2.adoptRequest(request1);

		assert.strictEqual(model1.getRequests().length, 0);
		assert.strictEqual(model2.getRequests().length, 1);
		assert.ok(request1.session === model2);
		assert.ok(request1.response?.session === model2);

		model2.acceptResponseProgress(request1, { content: new MarkdownString('Hello'), kind: 'markdownContent' });

		assert.strictEqual(request1.response.response.toString(), 'Hello');
	});
});

suite('Response', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('mergeable markdown', async () => {
		const response = new Response([]);
		response.updateContent({ content: new MarkdownString('markdown1'), kind: 'markdownContent' });
		response.updateContent({ content: new MarkdownString('markdown2'), kind: 'markdownContent' });
		await assertSnapshot(response.value);

		assert.strictEqual(response.toString(), 'markdown1markdown2');
	});

	test('not mergeable markdown', async () => {
		const response = new Response([]);
		const md1 = new MarkdownString('markdown1');
		md1.supportHtml = true;
		response.updateContent({ content: md1, kind: 'markdownContent' });
		response.updateContent({ content: new MarkdownString('markdown2'), kind: 'markdownContent' });
		await assertSnapshot(response.value);
	});

	test('inline reference', async () => {
		const response = new Response([]);
		response.updateContent({ content: new MarkdownString('text before'), kind: 'markdownContent' });
		response.updateContent({ inlineReference: URI.parse('https://microsoft.com'), kind: 'inlineReference' });
		response.updateContent({ content: new MarkdownString('text after'), kind: 'markdownContent' });
		await assertSnapshot(response.value);
	});
});
