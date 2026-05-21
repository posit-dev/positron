/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { validateCustomProviderApiKey } from '../validation/customProvider';
import { log } from '../log';

suite('validateCustomProviderApiKey', () => {
	let originalFetch: typeof globalThis.fetch;
	let requestedBodies: string[];
	let mockGet: sinon.SinonStub;
	let logWarnStub: sinon.SinonStub;

	setup(() => {
		originalFetch = globalThis.fetch;
		requestedBodies = [];

		mockGet = sinon.stub();
		const mockConfig: vscode.WorkspaceConfiguration = {
			get: mockGet,
			has: sinon.stub(),
			inspect: sinon.stub(),
			update: sinon.stub(),
		};
		sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);
		logWarnStub = sinon.stub(log, 'warn');
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		sinon.restore();
	});

	function makeConfig(): positron.ai.LanguageModelConfig {
		return {
			provider: 'openai-compatible',
			name: 'Custom Provider',
			model: '',
			type: positron.PositronLanguageModelType.Chat,
			baseUrl: 'https://example.com/v1',
		};
	}

	function stubFetch(status: number): void {
		globalThis.fetch = async (_url, init) => {
			requestedBodies.push((init?.body as string) ?? '');
			return { ok: status >= 200 && status < 300, status } as Response;
		};
	}

	test('sends empty model when no override is configured', async () => {
		mockGet.returns(undefined);
		stubFetch(200);

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.deepStrictEqual(JSON.parse(requestedBodies[0]), { model: '', messages: [] });
	});

	test('sends the first override identifier as the model', async () => {
		mockGet.withArgs('models.overrides.customProvider').returns([
			{ name: 'Databricks Claude', identifier: 'databricks-claude-sonnet-4-6' },
		]);
		stubFetch(200);

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.deepStrictEqual(JSON.parse(requestedBodies[0]), {
			model: 'databricks-claude-sonnet-4-6',
			messages: [],
		});
	});

	test('soft-fails HTTP 404 with a warning', async () => {
		mockGet.returns(undefined);
		stubFetch(404);

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.strictEqual(logWarnStub.callCount, 1);
		assert.match(logWarnStub.firstCall.args[0] as string, /Custom Provider/);
		assert.match(logWarnStub.firstCall.args[0] as string, /404/);
	});

	test('throws model-not-authorized message on 403 when no model override is set', async () => {
		mockGet.returns(undefined);
		stubFetch(403);

		await assert.rejects(
			validateCustomProviderApiKey('sk-test', makeConfig()),
			/Custom Provider test model was rejected/
		);
	});

	test('throws credential-failure message on 403 when override is set', async () => {
		mockGet.withArgs('models.overrides.customProvider').returns([
			{ identifier: 'real-model-id' },
		]);
		stubFetch(403);

		await assert.rejects(
			validateCustomProviderApiKey('sk-test', makeConfig()),
			/Invalid Custom Provider API key/
		);
	});
});
