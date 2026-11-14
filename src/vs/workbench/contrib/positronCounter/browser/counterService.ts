/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createStore, StoreApi } from 'zustand/vanilla';
import { createJSONStorage, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { COUNTER_HISTORY_LIMIT, COUNTER_INITIAL_VALUE_KEY, COUNTER_STORAGE_KEY, CounterOp, CounterState, ICounterService } from '../common/counter.js';
import { createStorageStateStorage } from '../common/counterStorage.js';

/**
 * Creates the counter store: immer for mutation-style updates, persist for
 * saving `value` and `stats` (not `history`) through Positron storage.
 */
function createCounterStore(initialValue: number, storageService: IStorageService) {
	return createStore<CounterState>()(
		persist(
			immer(() => ({
				value: initialValue,
				history: [],
				stats: {
					min: initialValue,
					max: initialValue,
					counts: { increment: 0, decrement: 0, reset: 0 },
				},
			})),
			{
				name: COUNTER_STORAGE_KEY,
				version: 1,
				storage: createJSONStorage(() => createStorageStateStorage(storageService)),
				partialize: state => ({ value: state.value, stats: state.stats }),
				// Where a schema change would convert older persisted state. Version 1 is
				// the first shape, so older state passes through unchanged.
				migrate: persistedState => persistedState as CounterState,
			}
		)
	);
}

/**
 * The counter demo service. It owns a zustand vanilla store and has no React
 * dependency; React components bind to `store` with zustand's `useStore`.
 */
export class CounterService extends Disposable implements ICounterService {
	declare readonly _serviceBrand: undefined;

	private readonly _counterStore: ReturnType<typeof createCounterStore>;

	constructor(
		@IStorageService storageService: IStorageService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
		this._counterStore = createCounterStore(this.readInitialValue(), storageService);
	}

	get store(): StoreApi<CounterState> {
		return this._counterStore;
	}

	get canUndo(): boolean {
		return this._counterStore.getState().history.length > 0;
	}

	increment(amount = 1): void {
		this.change('increment', value => value + amount, amount);
	}

	decrement(amount = 1): void {
		this.change('decrement', value => value - amount, amount);
	}

	reset(): void {
		const target = this.readInitialValue();
		this.change('reset', () => target, target - this._counterStore.getState().value);
	}

	undo(): void {
		if (!this.canUndo) {
			return;
		}
		this._counterStore.setState(state => {
			const entry = state.history.pop()!;
			state.value = entry.from;
		});
	}

	/** Applies one change, recording history and stats in a single immer update. */
	private change(op: CounterOp, next: (value: number) => number, amount: number): void {
		if (!Number.isFinite(amount)) {
			return;
		}
		// A finite amount can still overflow; Infinity would persist as null.
		const to = next(this._counterStore.getState().value);
		if (!Number.isFinite(to)) {
			return;
		}
		this._counterStore.setState(state => {
			const from = state.value;
			state.value = to;
			state.history.push({ op, amount, from, to, at: Date.now() });
			if (state.history.length > COUNTER_HISTORY_LIMIT) {
				state.history.splice(0, state.history.length - COUNTER_HISTORY_LIMIT);
			}
			state.stats.min = Math.min(state.stats.min, to);
			state.stats.max = Math.max(state.stats.max, to);
			state.stats.counts[op]++;
		});
	}

	/** Reads the setting live; anything but a finite number falls back to 0. */
	private readInitialValue(): number {
		const value = this._configurationService.getValue<unknown>(COUNTER_INITIAL_VALUE_KEY);
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}
}
