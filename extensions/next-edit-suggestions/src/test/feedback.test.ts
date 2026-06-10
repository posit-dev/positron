/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';

import { sendFeedback } from '../feedback.js';
import * as clientModule from '../client.js';
import * as modelModule from '../model.js';
import { makeFakeClientManager, makeLLMConfig, type FakeClientManager } from './testUtils.js';

// sendFeedback is fire-and-forget: it kicks off `getLLMConfiguration().then(...)`
// without returning a promise, so flush the microtask/timer queue before asserting.
const flush = () => new Promise((resolve) => setImmediate(resolve));

suite('feedback / sendFeedback', () => {
	let fake: FakeClientManager;
	let getClientManager: sinon.SinonStub;
	let getLLMConfiguration: sinon.SinonStub;

	setup(() => {
		fake = makeFakeClientManager();
		getClientManager = sinon.stub(clientModule, 'getLanguageClientManager').returns(fake.manager);
		getLLMConfiguration = sinon.stub(modelModule, 'getLLMConfiguration').resolves(makeLLMConfig());
	});

	teardown(() => {
		sinon.restore();
	});

	test('submits a completion-feedback request with the correlation id and config', async () => {
		const llmConfig = makeLLMConfig();
		getLLMConfiguration.resolves(llmConfig);
		fake.sendRequest.resolves({ success: true });

		sendFeedback('abc', 'accepted');
		await flush();

		assert.ok(fake.sendRequest.calledOnce);
		const [requestType, payload] = fake.sendRequest.firstCall.args;
		assert.strictEqual(requestType.method, 'supercomplete/submitCompletionFeedback');
		assert.deepStrictEqual(payload, { correlationId: 'abc', feedback: 'accepted', llmConfig });
	});

	test('does nothing when no language client is running', async () => {
		getClientManager.returns(undefined);

		sendFeedback('abc', 'rejected');
		await flush();

		assert.ok(fake.sendRequest.notCalled);
	});

	test('does nothing when no LLM configuration is available', async () => {
		getLLMConfiguration.resolves(null);

		sendFeedback('abc', 'accepted');
		await flush();

		assert.ok(fake.sendRequest.notCalled);
	});
});
