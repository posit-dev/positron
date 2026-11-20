/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { DisposableStore, DisposableTracker, IDisposable, setDisposableTracker } from '../../base/common/lifecycle.js';

/**
 * Vitest equivalent of `ensureNoDisposablesAreLeakedInTestSuite()` from `utils.ts`.
 *
 * **Use this in `.vitest.ts` / `.vitest.tsx` files only.** For Mocha `.test.ts`
 * files, use `ensureNoDisposablesAreLeakedInTestSuite()` from `utils.ts` instead.
 * The two are NOT interchangeable -- they use different test lifecycle hooks.
 *
 * Most tests don't call this directly -- `createTestContainer().build()` calls
 * it internally. You only need it in plain tests (no builder) that create
 * disposables directly.
 *
 * Tracks disposable creation/disposal across each test. If any disposables
 * are created but not disposed by the end of a test, the test fails.
 *
 * Returns a disposable store that tests can use to register disposables
 * via `disposables.add(disposable)`.
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

	// Narrow ctx so this file type-checks when pulled into the main src/ compile (no Vitest globals).
	type AfterEachContext = { task?: { result?: { state?: string } } } | undefined;
	afterEach((ctx) => {
		store.dispose();
		setDisposableTracker(null);
		if ((ctx as AfterEachContext)?.task?.result?.state !== 'fail') {
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

/**
 * Creates a bubbling, cancelable wheel event. The test DOM's WheelEvent ignores the modifier keys
 * in its init dictionary, so ctrlKey is defined on the event directly.
 * @param init The vertical delta and whether Ctrl is held.
 * @returns The wheel event.
 */
export function createWheelEvent(init: { deltaY: number; ctrlKey?: boolean }): WheelEvent {
	const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: init.deltaY });
	Object.defineProperty(event, 'ctrlKey', { value: init.ctrlKey ?? false });
	return event;
}
