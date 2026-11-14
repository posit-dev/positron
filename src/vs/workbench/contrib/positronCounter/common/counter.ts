/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StoreApi } from 'zustand/vanilla';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** The setting that holds the counter's starting value and reset target. */
export const COUNTER_INITIAL_VALUE_KEY = 'counter.initialValue';

/** The storage key the persist middleware writes to. */
export const COUNTER_STORAGE_KEY = 'positron.counter.state';

/** The command that opens the Counter editor. */
export const COUNTER_OPEN_COMMAND_ID = 'positron.counter.open';

/** The maximum number of history entries kept in memory. */
export const COUNTER_HISTORY_LIMIT = 50;

/** An operation that changes the counter. */
export type CounterOp = 'increment' | 'decrement' | 'reset';

/** One recorded change to the counter. */
export interface CounterHistoryEntry {
	op: CounterOp;
	/** The increment/decrement amount; for reset, `to - from`. */
	amount: number;
	from: number;
	to: number;
	/** `Date.now()` when the change happened. */
	at: number;
}

/** Lifetime statistics for the counter. */
export interface CounterStats {
	min: number;
	max: number;
	counts: Record<CounterOp, number>;
}

/** The state held in the counter's zustand store. */
export interface CounterState {
	value: number;
	/** Oldest first. In memory only; not persisted. */
	history: CounterHistoryEntry[];
	stats: CounterStats;
}

export const ICounterService = createDecorator<ICounterService>('positronCounterService');

/**
 * A demo service whose state lives in a zustand vanilla store. Consumers read
 * (and subscribe to) `store`; all changes go through the service's methods.
 */
export interface ICounterService {
	readonly _serviceBrand: undefined;

	/** The store. Read-only by convention: change state through the methods below. */
	readonly store: StoreApi<CounterState>;

	/** Whether there is a history entry to undo. */
	readonly canUndo: boolean;

	/** Adds `amount` (default 1). Non-finite amounts are ignored. */
	increment(amount?: number): void;

	/** Subtracts `amount` (default 1). Non-finite amounts are ignored. */
	decrement(amount?: number): void;

	/** Returns the value to the configured initial value. */
	reset(): void;

	/** Restores the value before the most recent change. No-op when history is empty. */
	undo(): void;
}
