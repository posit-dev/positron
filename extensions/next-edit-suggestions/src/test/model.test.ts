/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { getLLMConfiguration, resetModelCache } from '../model.js';
import * as configModule from '../config.js';

const BASE_URL = 'https://gateway.example.test';

function modelsResponse() {
	return {
		ok: true,
		json: async () => ({
			completions: [
				{ id: 'model-a', display_name: 'Model A', endpoints: [{ path: '/a/predict', protocol: 'a' }], weight: 0.5 },
				{ id: 'model-b', display_name: 'Model B', endpoints: [{ path: '/b/predict', protocol: 'b' }], weight: 0.5 },
			],
		}),
	} as unknown as Response;
}

suite('model / getLLMConfiguration', () => {
	let getSession: sinon.SinonStub;
	let fetchStub: sinon.SinonStub;
	let getSelectedModelId: sinon.SinonStub;

	setup(() => {
		getSession = sinon.stub(vscode.authentication, 'getSession');
		sinon.stub(configModule, 'getGatewayBaseUrl').returns(BASE_URL);
		getSelectedModelId = sinon.stub(configModule, 'getSelectedCompletionModelId').returns('');
		fetchStub = sinon.stub(globalThis, 'fetch');
		// Deterministic weighted selection: random=0 always picks the first model.
		sinon.stub(Math, 'random').returns(0);
	});

	teardown(() => {
		sinon.restore();
		resetModelCache();
	});

	test('returns null when there is no auth session', async () => {
		getSession.resolves(undefined);

		assert.strictEqual(await getLLMConfiguration(), null);
		assert.ok(fetchStub.notCalled);
	});

	test('builds a config from the fetched models for the active session', async () => {
		getSession.resolves({ accessToken: 'tok' } as vscode.AuthenticationSession);
		fetchStub.resolves(modelsResponse());

		const config = await getLLMConfiguration();

		assert.ok(config);
		assert.strictEqual(config!.modelId, 'model-a');
		assert.strictEqual(config!.endpointPath, '/a/predict');
		assert.strictEqual(config!.baseUrl, BASE_URL);
		assert.strictEqual(config!.accessToken, 'tok');
		assert.strictEqual(config!.maxContextTokens, 5000);
		assert.strictEqual(config!.maxOutputTokens, 256);
		assert.ok(config!.options.userAgent);
		assert.ok(fetchStub.calledOnceWith(`${BASE_URL}/models`));
	});

	test('honors an explicitly selected completion model', async () => {
		getSelectedModelId.returns('model-b');
		getSession.resolves({ accessToken: 'tok' } as vscode.AuthenticationSession);
		fetchStub.resolves(modelsResponse());

		const config = await getLLMConfiguration();

		assert.strictEqual(config!.modelId, 'model-b');
		assert.strictEqual(config!.endpointPath, '/b/predict');
	});

	test('falls back to the default model when the selected id is unknown', async () => {
		getSelectedModelId.returns('does-not-exist');
		getSession.resolves({ accessToken: 'tok' } as vscode.AuthenticationSession);
		fetchStub.resolves(modelsResponse());

		const config = await getLLMConfiguration();

		assert.strictEqual(config!.modelId, 'qwen3-8b');
		assert.strictEqual(config!.endpointPath, '/completions/qwen3-8b/predict');
	});

	test('falls back to the default model when fetching models fails', async () => {
		getSession.resolves({ accessToken: 'tok' } as vscode.AuthenticationSession);
		fetchStub.rejects(new Error('network down'));

		const config = await getLLMConfiguration();

		assert.strictEqual(config!.modelId, 'qwen3-8b');
		assert.strictEqual(config!.endpointPath, '/completions/qwen3-8b/predict');
	});
});
