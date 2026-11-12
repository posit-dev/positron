/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useStore } from 'zustand';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CounterState } from '../../common/counter.js';

/**
 * Binds a component to a slice of the counter service's store. The component
 * re-renders only when the selected value changes (compared with `Object.is`).
 *
 * A selector that builds a new object or array must be wrapped in `useShallow`
 * from `zustand/react/shallow`; otherwise every check sees a "change" and React
 * re-renders in a loop. Selecting existing pieces (`s => s.stats`) needs nothing.
 */
export function useCounterStore<T>(selector: (state: CounterState) => T): T {
	const { counterService } = usePositronReactServicesContext();
	return useStore(counterService.store, selector);
}
