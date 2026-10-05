/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import * as sinon from 'sinon';
import { log } from '../log';
import { PROVIDER_METADATA } from '../providerSources';
import { validateAnthropicApiKey, validateDeepSeekApiKey, validateGeminiApiKey, validateOpenaiApiKey } from '../validation';
import { stubValidationCatalog } from './validationTestUtils';

type Validator = (apiKey: string, config: positron.ai.LanguageModelConfig) => Promise<void>;

const VALIDATORS: [string, string, Validator][] = [
	['Anthropic', PROVIDER_METADATA.anthropic.catalogId!, validateAnthropicApiKey],
	['OpenAI', PROVIDER_METADATA.openai.catalogId!, validateOpenaiApiKey],
	['Gemini', PROVIDER_METADATA.google.catalogId!, validateGeminiApiKey],
	['DeepSeek', PROVIDER_METADATA.deepseek.catalogId!, validateDeepSeekApiKey],
];

suite('API key validation with model discovery off', () => {
	let originalFetch: typeof globalThis.fetch;
	let requestedUrls: string[];

	setup(() => {
		originalFetch = globalThis.fetch;
		requestedUrls = [];
		globalThis.fetch = async url => {
			requestedUrls.push(url as string);
			return { ok: false, status: 404, json: async () => ({}) } as Response;
		};
		sinon.stub(log, 'info');
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		sinon.restore();
	});

	for (const [label, catalogId, validate] of VALIDATORS) {
		test(`${label} accepts the key without querying /models`, async () => {
			stubValidationCatalog({ [catalogId]: { models: { discovery: 'off' } } });

			await validate('key', { baseUrl: 'https://gateway.example.com/v1' });

			assert.deepStrictEqual(requestedUrls, []);
		});

		test(`${label} still queries /models when discovery is auto`, async () => {
			stubValidationCatalog({ [catalogId]: { models: { discovery: 'auto' } } });

			await assert.rejects(validate('key', { baseUrl: 'https://gateway.example.com/v1' }), /HTTP 404/);

			assert.deepStrictEqual(requestedUrls, ['https://gateway.example.com/v1/models']);
		});
	}
});
