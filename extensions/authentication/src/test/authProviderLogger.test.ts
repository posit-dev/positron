/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AuthProviderLogger } from '../authProviderLogger';

/**
 * Capture log calls by replacing the module-level log instance.
 * Returns a list of { level, message } entries.
 */
function createCapture() {
	const captured: { level: string; message: string }[] = [];
	return {
		captured,
		trace: (msg: string) => captured.push({ level: 'trace', message: msg }),
		debug: (msg: string) => captured.push({ level: 'debug', message: msg }),
		info: (msg: string) => captured.push({ level: 'info', message: msg }),
		warn: (msg: string) => captured.push({ level: 'warn', message: msg }),
		error: (msg: string) => captured.push({ level: 'error', message: msg }),
	};
}

suite('AuthProviderLogger', () => {
	test('prefixes messages with provider name', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('Anthropic', capture as any);

		logger.info('hello');

		assert.strictEqual(capture.captured.length, 1);
		assert.strictEqual(capture.captured[0].message, '[Anthropic] hello');
		assert.strictEqual(capture.captured[0].level, 'info');
	});

	test('warn with error appends formatted error', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('Test', capture as any);

		logger.warn('something failed', new Error('bad input'));

		assert.strictEqual(
			capture.captured[0].message,
			'[Test] something failed: bad input'
		);
	});

	test('error with error object appends formatted error', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('Test', capture as any);

		logger.error('operation failed', { code: 403, reason: 'forbidden' });

		const msg = capture.captured[0].message;
		assert.ok(msg.startsWith('[Test] operation failed: '));
		assert.ok(msg.includes('"code": 403'));
	});
});

suite('AuthProviderLogger convenience methods', () => {
	test('logCredentialResolution failed logs at debug', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('AWS', capture as any);

		logger.logCredentialResolution(
			'failed',
			'Initial credential resolution failed: no profile'
		);

		assert.strictEqual(capture.captured[0].level, 'debug');
		assert.ok(capture.captured[0].message.includes(
			'Initial credential resolution failed: no profile'
		));
	});

	test('logSessionChange retrieved logs at debug', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('Foundry', capture as any);

		logger.logSessionChange(
			'retrieved',
			'getSessions: returned 2 stored session(s)'
		);

		assert.strictEqual(capture.captured[0].level, 'debug');
		assert.ok(capture.captured[0].message.includes(
			'getSessions: returned 2 stored session(s)'
		));
	});

	test('logOperationError logs at error with formatted error', () => {
		const capture = createCapture();
		// eslint-disable-next-line local/code-no-any-casts
		const logger = new AuthProviderLogger('Foundry', capture as any);

		logger.logOperationError(
			'sync Foundry endpoint',
			new Error('network timeout')
		);

		assert.strictEqual(capture.captured[0].level, 'error');
		assert.strictEqual(
			capture.captured[0].message,
			'[Foundry] Error in sync Foundry endpoint: network timeout'
		);
	});
});
