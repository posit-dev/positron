/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CoalescingLoader, STATE_CHANGE_DELAY_MS } from '../../browser/components/useCheckpointsState.js';

describe('CoalescingLoader', () => {
	let started: number;
	let pending: ((value: number) => void)[];
	let applied: number[];
	let loader: CoalescingLoader<number>;

	beforeEach(() => {
		vi.useFakeTimers();
		started = 0;
		pending = [];
		applied = [];
		loader = new CoalescingLoader<number>(
			() => {
				started++;
				return new Promise<number>(resolve => pending.push(resolve));
			},
			value => applied.push(value),
			STATE_CHANGE_DELAY_MS,
		);
	});

	afterEach(() => {
		loader.dispose();
		vi.useRealTimers();
	});

	test('the state change delay is 300 ms', () => {
		expect(STATE_CHANGE_DELAY_MS).toBe(300);
	});

	test('a burst of state changes within 300 ms starts one load', async () => {
		for (let index = 0; index < 10; index++) {
			loader.requestSoon();
			await vi.advanceTimersByTimeAsync(25);
		}
		await vi.advanceTimersByTimeAsync(STATE_CHANGE_DELAY_MS);
		expect(started).toBe(1);

		pending[0](1);
		await vi.advanceTimersByTimeAsync(STATE_CHANGE_DELAY_MS);
		expect(started).toBe(1);
		expect(applied).toEqual([1]);
	});

	test('requests while a load runs queue one more load, and the running result is dropped', async () => {
		loader.request();
		loader.request();
		loader.request();
		loader.requestSoon();
		await vi.advanceTimersByTimeAsync(STATE_CHANGE_DELAY_MS);
		expect(started).toBe(1);

		pending[0](1);
		await vi.advanceTimersByTimeAsync(0);
		expect(started).toBe(2);
		expect(applied).toEqual([]);

		pending[1](2);
		await vi.advanceTimersByTimeAsync(0);
		expect(started).toBe(2);
		expect(applied).toEqual([2]);
	});

	test('after disposal nothing starts and no result is applied', async () => {
		loader.request();
		loader.requestSoon();
		loader.dispose();
		pending[0](1);
		await vi.advanceTimersByTimeAsync(STATE_CHANGE_DELAY_MS);

		expect(started).toBe(1);
		expect(applied).toEqual([]);
	});
});
