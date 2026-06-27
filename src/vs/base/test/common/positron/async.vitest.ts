/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { SelfHealingLazyPromise } from '../../../common/positron/async.js';

describe('SelfHealingLazyPromise', () => {
	it('computes once and shares the value across calls', async () => {
		const compute = vi.fn(async () => 'value');
		const lazy = new SelfHealingLazyPromise(compute);

		expect(await Promise.all([lazy.get(), lazy.get()])).toEqual(['value', 'value']);
		expect(await lazy.get()).toBe('value');
		expect(compute).toHaveBeenCalledTimes(1);
	});

	it('does not cache a rejection: the next call retries', async () => {
		const compute = vi.fn()
			.mockRejectedValueOnce(new Error('transient'))
			.mockResolvedValue('recovered');
		const lazy = new SelfHealingLazyPromise<string>(compute);

		await expect(lazy.get()).rejects.toThrow('transient');
		expect(await lazy.get()).toBe('recovered');
		expect(compute).toHaveBeenCalledTimes(2);
	});

	it('clear() drops a settled value so the next call recomputes', async () => {
		let calls = 0;
		const lazy = new SelfHealingLazyPromise(async () => ++calls);

		expect(await lazy.get()).toBe(1);
		lazy.clear();
		expect(await lazy.get()).toBe(2);
	});

	it('a cleared in-flight rejection does not wipe the replacement value', async () => {
		let reject!: (err: Error) => void;
		const first = new Promise<string>((_, rej) => { reject = rej; });
		const compute = vi.fn()
			.mockReturnValueOnce(first)
			.mockResolvedValue('fresh');
		const lazy = new SelfHealingLazyPromise<string>(compute);

		const stale = lazy.get();
		lazy.clear();
		const replacement = lazy.get();

		reject(new Error('stale failure'));
		await expect(stale).rejects.toThrow('stale failure');

		// The stale rejection must not clear the replacement's cache.
		expect(await replacement).toBe('fresh');
		expect(await lazy.get()).toBe('fresh');
		expect(compute).toHaveBeenCalledTimes(2);
	});
});
