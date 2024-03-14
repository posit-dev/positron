/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IObserver, ISettableObservable } from 'vs/base/common/observableInternal/base';

/**
 * Helper for observing an observable value. Returns a function
 * that can be called to stop observing the value. This is useful
 * for things like React.useEffect.
 * @param observableValue Observable value to observe
 * @param observerCallbacks Observer callbacks. Unlike the `IObserver` class these
 * callbacks are optional. In order to get the new value in the handleChange callback
 * the easiest way is to simply call `observableValue.get()`. Alternatively the observed
 * value is provided as the first argument to the callback.
 * @returns A function that can be called to stop observing the value. Aka
 * `observableValue.removeObserver(observer)`.
 */
export function observeValue<T>(observableValue: ISettableObservable<T>, observerCallbacks: Partial<IObserver>): () => void {

	const observer: IObserver = {
		handleChange() {
		},
		beginUpdate() {
		},
		endUpdate() {
		},
		handlePossibleChange() {
		},
		...observerCallbacks
	};

	observableValue.addObserver(observer);
	return () => observableValue.removeObserver(observer);
}


/**
 * Helper for observing an observable value that can be undefined.
 * This is typically for cases where the value is not available at
 * initialization but will be set later.
 */
export type OptionalObservable<T> = ISettableObservable<
	T | undefined,
	void
>;
