/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isCancellationTokenLike, raceTimeout } from '../asyncUtils.js';

suite('raceTimeout', () => {
	test('returns the resolved value when the promise wins', async () => {
		const result = await raceTimeout(Promise.resolve(42), 100);
		assert.strictEqual(result, 42);
	});

	test('returns undefined when the timeout wins', async () => {
		const slow = new Promise<number>(resolve => setTimeout(() => resolve(1), 100));
		const result = await raceTimeout(slow, 10);
		assert.strictEqual(result, undefined);
	});

	test('propagates rejection when the promise rejects before the timeout', async () => {
		const failed = Promise.reject(new Error('boom'));
		await assert.rejects(() => raceTimeout(failed, 100), /boom/);
	});

	test('does not surface unhandled rejection when the promise rejects after the timeout', async () => {
		// Capture unhandled rejections during this test only.
		const seen: unknown[] = [];
		const onUnhandled = (reason: unknown) => { seen.push(reason); };
		process.on('unhandledRejection', onUnhandled);
		try {
			const lateFail = new Promise<number>((_resolve, reject) =>
				setTimeout(() => reject(new Error('late')), 30));
			const result = await raceTimeout(lateFail, 5);
			assert.strictEqual(result, undefined);
			// Wait past the rejection so the runtime has a chance to flag it.
			await new Promise(r => setTimeout(r, 80));
			assert.deepStrictEqual(seen, [], 'late rejection should be swallowed by raceTimeout');
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	test('invokes onTimeout exactly once when the timeout wins', async () => {
		let calls = 0;
		const slow = new Promise<number>(resolve => setTimeout(() => resolve(1), 50));
		await raceTimeout(slow, 10, () => { calls++; });
		// Wait long enough that the slow promise has settled too.
		await new Promise(r => setTimeout(r, 80));
		assert.strictEqual(calls, 1);
	});

	test('does not invoke onTimeout when the promise wins', async () => {
		let calls = 0;
		await raceTimeout(Promise.resolve('ok'), 100, () => { calls++; });
		assert.strictEqual(calls, 0);
	});
});

suite('isCancellationTokenLike', () => {
	test('accepts a well-formed token', () => {
		const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { } }) };
		assert.strictEqual(isCancellationTokenLike(token), true);
	});

	test('rejects undefined and null', () => {
		assert.strictEqual(isCancellationTokenLike(undefined), false);
		assert.strictEqual(isCancellationTokenLike(null), false);
	});

	test('rejects primitives', () => {
		assert.strictEqual(isCancellationTokenLike(0), false);
		assert.strictEqual(isCancellationTokenLike(''), false);
		assert.strictEqual(isCancellationTokenLike(true), false);
		assert.strictEqual(isCancellationTokenLike('token'), false);
	});

	test('rejects an object missing onCancellationRequested', () => {
		assert.strictEqual(isCancellationTokenLike({ isCancellationRequested: false }), false);
	});

	test('rejects an object missing isCancellationRequested', () => {
		assert.strictEqual(isCancellationTokenLike({ onCancellationRequested: () => ({ dispose: () => { } }) }), false);
	});

	test('rejects an object with the wrong field types', () => {
		assert.strictEqual(isCancellationTokenLike({ isCancellationRequested: 'no', onCancellationRequested: 'no' }), false);
	});

	test('returns false (does not throw) when a getter throws', () => {
		const trap = Object.defineProperty(
			{ onCancellationRequested: () => ({ dispose: () => { } }) },
			'isCancellationRequested',
			{ get: () => { throw new Error('boom'); } },
		);
		assert.strictEqual(isCancellationTokenLike(trap), false);
	});
});
