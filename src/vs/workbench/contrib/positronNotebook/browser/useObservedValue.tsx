/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { autorun, IObservable } from '../../../../base/common/observable.js';

/**
 * Automatically updates the component when the observable changes.
 * @param observable Observable value with value to be extracted
 * @param map Optional mapping function to transform the observable value into a different value.
 * @returns The current value of the observable.
 */
export function useObservedValue<T>(observable: IObservable<T>): T;
export function useObservedValue<T, M extends (x: T) => unknown>(observable: IObservable<T>, map: M): M extends (x: T) => infer Out ? Out : never;
export function useObservedValue<T, M>(observable: IObservable<T>, map?: (x: T) => unknown): T | undefined | M extends (x: T) => infer Out ? Out : never {

	const [value, setValue] = React.useState(() => typeof map === 'function' ? map(observable.get()) : observable.get());

	React.useEffect(() => {
		const disposable = autorun(reader => {
			const val = observable.read(reader);
			setValue(typeof map === 'function' ? map(val) : val);
		});
		return () => {
			disposable.dispose();
		}
	}, [map, observable]);

	return value as T | M extends (x: T) => infer Out ? Out : never;
}
