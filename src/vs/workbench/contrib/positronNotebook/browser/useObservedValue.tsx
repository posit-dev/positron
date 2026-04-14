/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IObservable, debouncedObservable, runOnChange } from '../../../../base/common/observable.js';
import { isUndefinedOrNull } from '../../../../base/common/types.js';

/**
 * Automatically updates the component when the observable changes.
 * @param observable Observable value with value to be extracted
 * @returns The current value of the observable.
 */
export function useObservedValue<T>(observable: IObservable<T>): T;
/**
 * Automatically updates the component when the observable changes.
 * When observable is undefined, returns the defaultValue without subscribing.
 * @param observable Observable value with value to be extracted, or undefined
 * @param defaultValue Value to return when observable is undefined
 * @returns The current value of the observable, or defaultValue if observable is undefined.
 */
export function useObservedValue<T>(observable: IObservable<T> | undefined, defaultValue: T): T;
export function useObservedValue<T>(observable: IObservable<T> | undefined, defaultValue?: T): T {
	const [value, setValue] = React.useState(observable?.get() ?? defaultValue as T);

	React.useEffect(() => {
		if (!observable) {
			setValue(defaultValue as T);
			return;
		}
		// Sync state in case observable changed
		setValue(observable.get());
		const disposable = runOnChange(observable, setValue);
		return () => disposable.dispose();
	}, [observable, defaultValue]);

	return value;
}

/**
 * Like {@link useObservedValue}, but debounces value transitions where the
 * provided `shouldDebounce` predicate returns true. Non-debounced transitions
 * propagate immediately.
 *
 * Useful for suppressing transient UI flashes during cell re-execution without
 * delaying meaningful updates.
 *
 * @param observable The observable to subscribe to.
 * @param shouldDebounce Predicate receiving the new value. Return `true` to
 *   delay propagation by the specified `delayMs`, `false` to propagate
 *   immediately. Defaults to nullish check which covers `undefined` and `null`
 *   but not valid falsy values like `0` or `false`. Note that this is used in
 *   the dependency array of the `useMemo` call that creates the debounced
 *   observable, so it should be memoized if it is not a stable reference or
 *   otherwise the memo will be invalidated on every render, defeating the
 *   purpose of debouncing.
 * @param delayMs Optional debounce delay in milliseconds. Defaults to 150ms.
 */

export function useDebouncedObservedValue<T>(
	observable: IObservable<T>,
	shouldDebounce: (next: T) => boolean = isUndefinedOrNull,
	delayMs: number = 150,
): T {
	const debounced = React.useMemo(
		() => debouncedObservable(observable, (_prev, next) => shouldDebounce(next) ? delayMs : 0),
		// We dont need to worry about the delayMs causing invalidation because
		// pure number types are compared by value not reference in the
		// dependency arrays of hooks.
		[observable, shouldDebounce, delayMs]
	);
	return useObservedValue(debounced);
}
