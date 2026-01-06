/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IObservable, runOnChange } from '../../../../base/common/observable.js';

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
