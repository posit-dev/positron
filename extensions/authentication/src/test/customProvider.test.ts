/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as positron from 'positron';
import { validateCustomProviderApiKey } from '../validation/customProvider';
import { log } from '../log';

suite('validateCustomProviderApiKey', () => {
	let originalFetch: typeof globalThis.fetch;
	let requestedBodies: string[];
	let logWarnStub: sinon.SinonStub;

	setup(() => {
		originalFetch = globalThis.fetch;
		requestedBodies = [];
		logWarnStub = sinon.stub(log, 'warn');
	});

	teardown(() => {
		globalThis.fetch = originalFetch;
		sinon.restore();
	});

	function makeConfig(): positron.ai.LanguageModelConfig {
		return { baseUrl: 'https://example.com/v1' };
	}

	function stubFetch(status: number, body = ''): void {
		globalThis.fetch = async (_url, init) => {
			requestedBodies.push((init?.body as string) ?? '');
			return {
				ok: status >= 200 && status < 300,
				status,
				text: async () => body,
			} as Response;
		};
	}

	test('sends a placeholder model, not a real one', async () => {
		stubFetch(200);

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.deepStrictEqual(JSON.parse(requestedBodies[0]), {
			model: 'positron-connectivity-check',
			messages: [],
		});
	});

	test('rejects a 401 whose body points at the key', async () => {
		stubFetch(401, '{"error":{"message":"Invalid authentication credentials"}}');

		await assert.rejects(
			validateCustomProviderApiKey('sk-test', makeConfig()),
			/Invalid Custom Provider API key/
		);
	});

	test('accepts a 401 whose body points at the model, not the key', async () => {
		stubFetch(401, '{"error":{"type":"ModelError","message":"Model is not supported"}}');

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.match(logWarnStub.firstCall.args[0] as string, /model reason/);
	});

	test('soft-fails HTTP 404 with a warning', async () => {
		stubFetch(404);

		await validateCustomProviderApiKey('sk-test', makeConfig());

		assert.match(logWarnStub.firstCall.args[0] as string, /404/);
	});
});
