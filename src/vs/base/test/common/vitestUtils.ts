/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../common/lifecycle.js';

/**
 * Vitest equivalent of `ensureNoDisposablesAreLeakedInTestSuite()`.
 *
 * Tracks disposable creation/disposal across each test. If any disposables
 * are created but not disposed by the end of a test, the test fails.
 *
 * Returns a disposable store that tests can use to register disposables
 * via `ctx.add(disposable)`.
 *
 * @example
 * ```ts
 * describe('MyFeature', () => {
 *     const disposables = ensureNoLeakedDisposables();
 *
 *     it('creates and cleans up', () => {
 *         const d = disposables.add(new MyDisposable());
 *         // ...test logic...
 *     }); // disposables auto-disposed + leak check runs in afterEach
 * });
 * ```
 */
export function ensureNoLeakedDisposables(): Pick<DisposableStore, 'add'> {
	let tracker: DisposableTracker | undefined;
	let store: DisposableStore;

	beforeEach(() => {
		store = new DisposableStore();
		tracker = new DisposableTracker();
		setDisposableTracker(tracker);
	});

	afterEach((ctx) => {
		store.dispose();
		setDisposableTracker(null);
		if (ctx?.task?.result?.state !== 'fail') {
			const result = tracker!.computeLeakingDisposables();
			if (result) {
				throw new Error(`There are ${result.leaks.length} undisposed disposables!${result.details}`);
			}
		}
	});

	const testContext = {
		add<T extends IDisposable>(o: T): T {
			return store.add(o);
		}
	};
	return testContext;
}
