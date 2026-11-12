/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { CounterService } from '../../browser/counterService.js';
import { COUNTER_INITIAL_VALUE_KEY, COUNTER_STORAGE_KEY, CounterHistoryEntry } from '../../common/counter.js';

/** Strips the timestamp so history can be compared as a snapshot. */
function withoutTimestamps(history: readonly CounterHistoryEntry[]) {
	return history.map(({ op, amount, from, to }) => ({ op, amount, from, to }));
}

describe('CounterService', () => {
	const ctx = createLightTestContainer().build();

	function createStorage(): InMemoryStorageService {
		return ctx.disposables.add(new InMemoryStorageService());
	}

	function createService(options: { initialValue?: unknown; storage?: InMemoryStorageService } = {}) {
		const configuration = new TestConfigurationService({ [COUNTER_INITIAL_VALUE_KEY]: options.initialValue ?? 5 });
		const storage = options.storage ?? createStorage();
		const service = ctx.disposables.add(new CounterService(storage, configuration));
		return { service, configuration, storage };
	}

	it('starts at the configured initial value', () => {
		const { service } = createService();
		expect(service.store.getState()).toEqual({
			value: 5,
			history: [],
			stats: { min: 5, max: 5, counts: { increment: 0, decrement: 0, reset: 0 } },
		});
		expect(service.canUndo).toBe(false);
	});

	it('falls back to 0 for a non-numeric setting', () => {
		const { service } = createService({ initialValue: 'abc' });
		expect(service.store.getState().value).toBe(0);
	});

	it('increment and decrement default to 1 and accept an amount', () => {
		const { service } = createService();
		service.increment();
		service.increment(3);
		service.decrement();
		service.decrement(10);

		const state = service.store.getState();
		expect({ value: state.value, history: withoutTimestamps(state.history), stats: state.stats }).toEqual({
			value: -2,
			history: [
				{ op: 'increment', amount: 1, from: 5, to: 6 },
				{ op: 'increment', amount: 3, from: 6, to: 9 },
				{ op: 'decrement', amount: 1, from: 9, to: 8 },
				{ op: 'decrement', amount: 10, from: 8, to: -2 },
			],
			stats: { min: -2, max: 9, counts: { increment: 2, decrement: 2, reset: 0 } },
		});
		expect(service.canUndo).toBe(true);
	});

	it('ignores non-finite amounts', () => {
		const { service } = createService();
		const before = service.store.getState();
		service.increment(NaN);
		service.decrement(Infinity);
		expect(service.store.getState()).toBe(before);
	});

	it('reset reads the setting live', () => {
		const { service, configuration } = createService();
		service.increment(2);
		configuration.setUserConfiguration(COUNTER_INITIAL_VALUE_KEY, 10);
		service.reset();

		const state = service.store.getState();
		expect(state.value).toBe(10);
		expect(withoutTimestamps(state.history).at(-1)).toEqual({ op: 'reset', amount: 3, from: 7, to: 10 });
		expect(state.stats.counts.reset).toBe(1);
	});

	it('undo restores the previous value without touching stats', () => {
		const { service } = createService();
		service.increment();
		service.increment(4);
		const statsBefore = service.store.getState().stats;
		service.undo();

		const state = service.store.getState();
		expect(state.value).toBe(6);
		expect(state.history).toHaveLength(1);
		expect(state.stats).toBe(statsBefore);
		expect(state.stats.counts.increment).toBe(2);
	});

	it('undo on empty history is a no-op', () => {
		const { service } = createService();
		const before = service.store.getState();
		service.undo();
		expect(service.store.getState()).toBe(before);
	});

	it('caps history at 50', () => {
		const { service } = createService();
		for (let i = 0; i < 55; i++) {
			service.increment();
		}
		const history = service.store.getState().history;
		expect(history).toHaveLength(50);
		expect(history[0].from).toBe(10);
	});

	it('persists value and stats but not history', () => {
		const { service, storage } = createService();
		service.increment(2);

		expect(JSON.parse(storage.get(COUNTER_STORAGE_KEY, StorageScope.PROFILE)!)).toEqual({
			state: { value: 7, stats: { min: 5, max: 7, counts: { increment: 1, decrement: 0, reset: 0 } } },
			version: 1,
		});

		const { service: rehydrated } = createService({ storage });
		expect(rehydrated.store.getState()).toEqual({
			value: 7,
			history: [],
			stats: { min: 5, max: 7, counts: { increment: 1, decrement: 0, reset: 0 } },
		});
	});

	it('recovers from corrupt stored state', () => {
		const storage = createStorage();
		storage.store(COUNTER_STORAGE_KEY, '{not json', StorageScope.PROFILE, 1 /* StorageTarget.MACHINE */);
		const { service } = createService({ storage });
		expect(service.store.getState().value).toBe(5);
	});
});
