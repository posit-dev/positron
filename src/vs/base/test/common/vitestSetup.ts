/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../common/lifecycle.js';

/**
 * Vitest-compatible version of ensureNoDisposablesAreLeakedInTestSuite.
 * Returns a DisposableStore that is automatically cleaned up after each test.
 * Call this at the top level of a describe() block.
 */
export function ensureNoLeakedDisposables(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});

	afterEach(() => {
		store.dispose();
		setDisposableTracker(null);
		if (tracker) {
			const result = tracker.computeLeakingDisposables();
			if (result) {
				throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
			}
		}
	});

	return {
		add<T extends IDisposable>(o: T): T {
			return store.add(o);
		}
	};
}
