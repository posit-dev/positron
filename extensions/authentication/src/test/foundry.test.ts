/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { normalizeToV1Url } from '../validation/foundry';

suite('normalizeToV1Url', () => {
	test('converts full deployment URL to v1', () => {
		const input = 'https://r.azure.com/openai/deployments/m/chat/completions?api-version=2025-01-01-preview';
		assert.strictEqual(normalizeToV1Url(input), 'https://r.azure.com/openai/v1');
	});

	test('converts partial deployment URL to v1', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com/openai/deployments/m'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('preserves already-v1 URL', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com/openai/v1'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('strips trailing slash from v1 URL', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com/openai/v1/'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('appends /openai/v1 to bare endpoint with trailing slash', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com/'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('appends /openai/v1 to bare endpoint', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('strips query params from bare endpoint', () => {
		assert.strictEqual(
			normalizeToV1Url('https://r.azure.com?api-version=x'),
			'https://r.azure.com/openai/v1'
		);
	});

	test('handles empty string', () => {
		assert.strictEqual(
			normalizeToV1Url(''),
			''
		);
	});
});
