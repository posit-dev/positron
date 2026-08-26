/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { validateOpenaiApiKey } from '../validation/openai';
import { stubValidationCatalog } from './validationTestUtils';

suite('validateOpenaiApiKey custom headers', () => {
	test('sends configured headers from the openai catalog entry', async () => {
		const catalog = stubValidationCatalog({
			openai: {
				customHeaders: { 'X-Gateway-Token': 'gateway-key' },
			},
		});
		const originalFetch = globalThis.fetch;
		let requestedHeaders: Record<string, string> | undefined;
		globalThis.fetch = async (_url, init) => {
			requestedHeaders = init?.headers as Record<string, string>;
			return { ok: true, status: 200 } as Response;
		};

		try {
			await validateOpenaiApiKey('openai-key', {});
		} finally {
			globalThis.fetch = originalFetch;
			catalog.restore();
		}

		assert.strictEqual(requestedHeaders?.['X-Gateway-Token'], 'gateway-key');
	});
});
