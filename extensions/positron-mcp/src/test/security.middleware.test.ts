/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DEFAULT_SECURITY_CONFIG, MinimalSecurityMiddleware } from '../security.positron';
import { callMiddleware, fakeExtensionContext } from './testUtils';

// The CORS middleware is the server's localhost-only gate (DNS-rebinding Host
// guard + origin allow-list). It is pure request/response logic, so we drive it
// directly with fake req/res rather than over HTTP.
suite('MinimalSecurityMiddleware.corsMiddleware', () => {
	function cors() {
		const middleware = new MinimalSecurityMiddleware({ ...DEFAULT_SECURITY_CONFIG }, fakeExtensionContext());
		return middleware.corsMiddleware();
	}

	test('rejects a disallowed origin with 403', () => {
		const result = callMiddleware(cors(), { host: 'localhost:43123', origin: 'https://evil.com' });
		assert.strictEqual(result.statusCode, 403);
		assert.strictEqual(result.nextCalled, false);
	});

	test('rejects a non-local Host header with 403 (DNS-rebinding guard)', () => {
		const result = callMiddleware(cors(), { host: 'evil.com' });
		assert.strictEqual(result.statusCode, 403);
		assert.strictEqual(result.nextCalled, false);
	});

	test('allows a request with no Origin (non-browser client)', () => {
		const result = callMiddleware(cors(), { host: 'localhost:43123' });
		assert.strictEqual(result.nextCalled, true);
		assert.notStrictEqual(result.statusCode, 403);
	});

	test('allows an allowed origin and sets the CORS header', () => {
		const result = callMiddleware(cors(), { host: 'localhost:43123', origin: 'http://localhost:3000' });
		assert.strictEqual(result.nextCalled, true);
		assert.strictEqual(result.headers['Access-Control-Allow-Origin'], 'http://localhost:3000');
	});
});
