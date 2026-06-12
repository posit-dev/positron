/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { validateAnthropicApiKey } from '../validation/anthropic';

suite('validateAnthropicApiKey', () => {
	let originalFetch: typeof globalThis.fetch;
	let requestedUrls: string[];

	setup(() => {
		originalFetch = globalThis.fetch;
		requestedUrls = [];
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
	});

	function makeConfig(baseUrl?: string): positron.ai.LanguageModelConfig {
		return { baseUrl };
	}

	test('uses https://api.anthropic.com/v1 when no baseUrl is provided', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateAnthropicApiKey('sk-ant-valid', makeConfig());

		assert.strictEqual(requestedUrls.length, 1);
		assert.strictEqual(requestedUrls[0], 'https://api.anthropic.com/v1/models');
	});

	test('uses provided baseUrl without modification', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateAnthropicApiKey('sk-ant-valid', makeConfig('https://my.proxy.com/v2'));

		assert.strictEqual(requestedUrls.length, 1);
		assert.strictEqual(requestedUrls[0], 'https://my.proxy.com/v2/models');
	});

	test('falls back to /v1/ on non-auth HTTP failure', async () => {
		let callCount = 0;
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			callCount++;
			return { ok: callCount > 1, status: callCount === 1 ? 404 : 200 } as Response;
		};

		await validateAnthropicApiKey('sk-ant-valid', makeConfig('https://api.anthropic.com'));

		assert.strictEqual(requestedUrls.length, 2);
		assert.strictEqual(requestedUrls[0], 'https://api.anthropic.com/models');
		assert.strictEqual(requestedUrls[1], 'https://api.anthropic.com/v1/models');
	});

	test('does not fall back on 401 auth error', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: false, status: 401 } as Response;
		};

		await assert.rejects(
			validateAnthropicApiKey('sk-ant-invalid', makeConfig()),
			(error: Error) => error.message.includes('Invalid Anthropic API key')
		);

		assert.strictEqual(requestedUrls.length, 1, 'should not retry on auth error');
	});

	test('does not fall back on 403 auth error', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: false, status: 403 } as Response;
		};

		await assert.rejects(
			validateAnthropicApiKey('sk-ant-invalid', makeConfig()),
			(error: Error) => error.message.includes('Invalid Anthropic API key')
		);

		assert.strictEqual(requestedUrls.length, 1, 'should not retry on auth error');
	});

	test('throws with HTTP status when fallback also fails', async () => {
		let callCount = 0;
		globalThis.fetch = async () => {
			callCount++;
			return { ok: false, status: callCount === 1 ? 404 : 500 } as Response;
		};

		await assert.rejects(
			validateAnthropicApiKey('sk-ant-valid', makeConfig('https://api.anthropic.com')),
			(error: Error) => error.message.includes('500')
		);
	});

	test('strips trailing slash from baseUrl', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateAnthropicApiKey('sk-ant-valid', makeConfig('https://api.anthropic.com/v1/'));

		assert.strictEqual(requestedUrls[0], 'https://api.anthropic.com/v1/models');
	});

	test('does not append /v1 when baseUrl already ends with /v1', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: false, status: 404 } as Response;
		};

		await assert.rejects(
			validateAnthropicApiKey('sk-ant-valid', makeConfig('https://api.anthropic.com/v1')),
			(error: Error) => error.message.includes('404')
		);

		assert.strictEqual(requestedUrls.length, 1, 'should not retry when URL already has /v1');
	});

	test('does not append /v1 when baseUrl already ends with /v1/', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: false, status: 404 } as Response;
		};

		await assert.rejects(
			validateAnthropicApiKey('sk-ant-valid', makeConfig('https://api.anthropic.com/v1/')),
			(error: Error) => error.message.includes('404')
		);

		assert.strictEqual(requestedUrls.length, 1, 'should not retry when URL already has /v1/');
	});
});
