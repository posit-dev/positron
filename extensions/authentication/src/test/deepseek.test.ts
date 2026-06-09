/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import { validateDeepSeekApiKey } from '../validation/deepseek';
import { KEY_VALIDATION_TIMEOUT_MS } from '../constants';

suite('validateDeepSeekApiKey', () => {
	let originalFetch: typeof globalThis.fetch;
	let requestedUrls: string[];
	let requestedHeaders: Record<string, string>[];

	setup(() => {
		originalFetch = globalThis.fetch;
		requestedUrls = [];
		requestedHeaders = [];
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		sinon.restore();
	});

	function makeConfig(baseUrl?: string): positron.ai.LanguageModelConfig {
		return { baseUrl };
	}

	test('uses https://api.deepseek.com when no baseUrl is provided', async () => {
		globalThis.fetch = async (url, init) => {
			requestedUrls.push(url as string);
			requestedHeaders.push(init?.headers as Record<string, string>);
			return { ok: true, status: 200 } as Response;
		};

		await validateDeepSeekApiKey('sk-valid', makeConfig());

		assert.strictEqual(requestedUrls.length, 1);
		assert.strictEqual(requestedUrls[0], 'https://api.deepseek.com/models');
		assert.strictEqual(requestedHeaders[0]['Authorization'], 'Bearer sk-valid');
	});

	test('does not send to a relative /models URL when baseUrl is empty or whitespace', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateDeepSeekApiKey('sk-valid', makeConfig(''));
		await validateDeepSeekApiKey('sk-valid', makeConfig('   '));

		assert.notStrictEqual(requestedUrls[0], '/models');
		assert.notStrictEqual(requestedUrls[1], '/models');
	});

	test('uses provided baseUrl', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateDeepSeekApiKey('sk-valid', makeConfig('https://proxy.example.com/v1'));

		assert.strictEqual(requestedUrls[0], 'https://proxy.example.com/v1/models');
	});

	test('strips trailing slashes from baseUrl', async () => {
		globalThis.fetch = async (url) => {
			requestedUrls.push(url as string);
			return { ok: true, status: 200 } as Response;
		};

		await validateDeepSeekApiKey('sk-valid', makeConfig('https://api.deepseek.com///'));

		assert.strictEqual(requestedUrls[0], 'https://api.deepseek.com/models');
	});

	test('rejects on 401 with "Invalid DeepSeek API key"', async () => {
		globalThis.fetch = async () => ({ ok: false, status: 401 } as Response);

		await assert.rejects(
			validateDeepSeekApiKey('sk-invalid', makeConfig()),
			(err: Error) => err.message.includes('Invalid DeepSeek API key')
		);
	});

	test('rejects on 403 with "Invalid DeepSeek API key"', async () => {
		globalThis.fetch = async () => ({ ok: false, status: 403 } as Response);

		await assert.rejects(
			validateDeepSeekApiKey('sk-invalid', makeConfig()),
			(err: Error) => err.message.includes('Invalid DeepSeek API key')
		);
	});

	test('rejects on 500 with HTTP status', async () => {
		globalThis.fetch = async () => ({ ok: false, status: 500 } as Response);

		await assert.rejects(
			validateDeepSeekApiKey('sk-valid', makeConfig()),
			(err: Error) => err.message.includes('HTTP 500')
		);
	});

	test('rejects on AbortError with timeout message', async () => {
		const clock = sinon.useFakeTimers();
		globalThis.fetch = (_url, init) => {
			return new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					const err = new Error('aborted');
					err.name = 'AbortError';
					reject(err);
				});
			});
		};

		const validationPromise = assert.rejects(
			validateDeepSeekApiKey('sk-valid', makeConfig()),
			(err: Error) => /Could not validate DeepSeek API key within \d+ seconds/.test(err.message)
		);
		await clock.tickAsync(KEY_VALIDATION_TIMEOUT_MS);
		await validationPromise;
	});

	test('rejects on generic network error', async () => {
		globalThis.fetch = async () => {
			throw new Error('ECONNREFUSED');
		};

		await assert.rejects(
			validateDeepSeekApiKey('sk-valid', makeConfig()),
			(err: Error) => err.message.includes('Check your network connection')
		);
	});
});
