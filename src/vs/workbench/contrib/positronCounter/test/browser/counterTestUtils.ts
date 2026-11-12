/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CounterState, ICounterService } from '../../common/counter.js';

/**
 * Wraps the service store's `subscribe` so a test can count live subscriptions
 * made after this call. Returns a function that reports how many are live.
 */
export function trackSubscriptions(service: ICounterService): () => number {
	let active = 0;
	const store = service.store;
	const subscribe = store.subscribe;
	store.subscribe = (listener: (state: CounterState, previous: CounterState) => void) => {
		active++;
		const unsubscribe = subscribe(listener);
		return () => {
			active--;
			unsubscribe();
		};
	};
	return () => active;
}
