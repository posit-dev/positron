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
 * @returns The current value of the observable.
 */
export function useObservedValue<T>(observable: IObservable<T>): T {
	const [value, setValue] = React.useState(observable.get());

	React.useEffect(() => {
		const disposable = autorun(reader => {
			const val = observable.read(reader);
			setValue(val);
		});
		return () => {
			disposable.dispose();
		};
	}, [observable]);

	return value;
}
