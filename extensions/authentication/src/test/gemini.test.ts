/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { validateGeminiApiKey } from '../validation/gemini';
import { stubValidationCatalog } from './validationTestUtils';

suite('validateGeminiApiKey custom headers', () => {
	test('sends configured headers from the gemini catalog entry', async () => {
		const catalog = stubValidationCatalog({
			gemini: {
				customHeaders: { 'Ocp-Apim-Subscription-Key': 'gateway-key' },
			},
		});
		const originalFetch = globalThis.fetch;
		let requestedHeaders: Record<string, string> | undefined;
		globalThis.fetch = async (_url, init) => {
			requestedHeaders = init?.headers as Record<string, string>;
			return { ok: true, status: 200 } as Response;
		};

		try {
			await validateGeminiApiKey('gemini-key', {});
		} finally {
			globalThis.fetch = originalFetch;
			catalog.restore();
		}

		assert.strictEqual(
			requestedHeaders?.['Ocp-Apim-Subscription-Key'],
			'gateway-key'
		);
	});
});
