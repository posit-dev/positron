/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';
import { Event } from '../../../../base/common/event.js';

/**
 * Automatically updates the component when the observable changes.
 * @param observable Observable value with value to be extracted
 * @param map Optional mapping function to transform the observable value into a different value.
 * @returns The current value of the observable or undefined if the observable is not set.
 */
export function useObservedValue<T>(observable: ISettableObservable<T>): T | undefined;
export function useObservedValue<T, M extends (x: T) => unknown>(observable: ISettableObservable<T>, map: M): M extends (x: T) => infer Out ? Out : never;
export function useObservedValue<T, M>(observable: ISettableObservable<T>, map?: (x: T) => unknown): T | undefined | M extends (x: T) => infer Out ? Out : never {

	const [value, setValue] = React.useState(() => typeof map === 'function' ? map(observable.get()) : observable.get());

	React.useEffect(() => {
		const onObservableChange = Event.fromObservable(observable);
		const observer = onObservableChange((val) => {
			setValue(typeof map === 'function' ? map(val) : val);
		});

		return observer.dispose;
	}, [map, observable]);

	return value as T | undefined | M extends (x: T) => infer Out ? Out : never;
}
