/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment node

import * as sinon from 'sinon';
import { createOpenAICompatibleFetch } from '../openai-fetch-utils.js';

describe('Snowflake Provider', () => {

	afterEach(() => {
		sinon.restore();
	});

	describe('Error Message Enhancement', () => {
		// extractSnowflakeError is now a private function in snowflakeProvider.ts.
		// These error scenarios are covered by integration-level tests and the
		// auth extension's credential tests. The streaming fix test below
		// verifies the OpenAI-compatible fetch layer used by the provider.
		it.todo('covered by integration-level tests and auth extension credential tests');
	});

	describe('OpenAI Compatible Fetch - Snowflake Streaming Fix', () => {
		let fetchStub: sinon.SinonStub;

		beforeEach(() => {
			fetchStub = sinon.stub(global, 'fetch');
		});

		afterEach(() => {
			fetchStub.restore();
		});

		it('transforms empty role fields in streaming response', async () => {
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

			expect(response.status).toBe(200);

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
			expect(transformedText.includes('"role":"assistant"')).toBeTruthy();
			expect(!transformedText.includes('"role":""')).toBeTruthy();
		});
	});
});
