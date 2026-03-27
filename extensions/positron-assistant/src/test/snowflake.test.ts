/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { createOpenAICompatibleFetch } from '../openai-fetch-utils.js';

suite('Snowflake Provider', () => {

	teardown(() => {
		sinon.restore();
	});

	suite('Error Message Enhancement', () => {
		// extractSnowflakeError is now a private function in snowflakeProvider.ts.
		// These error scenarios are covered by integration-level tests and the
		// auth extension's credential tests. The streaming fix test below
		// verifies the OpenAI-compatible fetch layer used by the provider.
	});

	suite('OpenAI Compatible Fetch - Snowflake Streaming Fix', () => {
		let fetchStub: sinon.SinonStub;

		setup(() => {
			fetchStub = sinon.stub(global, 'fetch');
		});

		teardown(() => {
			fetchStub.restore();
		});

		test('transforms empty role fields in streaming response', async () => {
			const mockStreamingData = `data: {"choices":[{"delta":{"content":"Hi","role":"","tool_calls":null},"index":0}],"created":1234567890,"id":"test-id","model":"openai-gpt-5","object":"chat.completion.chunk"}

data: [DONE]

`;

			const mockResponse = new Response(mockStreamingData, {
				status: 200,
				headers: {
					'content-type': 'text/event-stream'
				}
			});

			fetchStub.resolves(mockResponse);

			const customFetch = createOpenAICompatibleFetch('Snowflake Cortex');
			const response = await customFetch('https://test.com/api', {
				method: 'POST',
				body: JSON.stringify({})
			});

			assert.strictEqual(response.status, 200);

			// Read the transformed stream
			const reader = response.body?.getReader();
			const chunks: string[] = [];
			if (reader) {
				while (true) {
					const { done, value } = await reader.read();
					if (done) { break; }
					chunks.push(new TextDecoder().decode(value));
				}
			}

			const transformedText = chunks.join('');

			// Verify that empty role field was transformed to "assistant"
			assert.ok(transformedText.includes('"role":"assistant"'), 'Empty role should be transformed to "assistant"');
			assert.ok(!transformedText.includes('"role":""'), 'Should not contain empty role field');
		});
	});
});
