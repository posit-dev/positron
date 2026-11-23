/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useCallback, useRef, useSyncExternalStore } from 'react';

// Other dependencies.
import { Event } from '../common/event.js';

/**
 * Reads a value that lives outside React, such as state owned by a service, and re-renders
 * the component whenever it changes.
 *
 * Use this instead of reading the value into `useState` and subscribing to its change event
 * in `useEffect`. That pattern loses any change that happens after the component renders but
 * before the effect subscribes. This hook does not: React reads the value again right after
 * it subscribes, and renders again if the value moved in between.
 *
 * @param onDidChange Fires when the value may have changed. It must be the same event on every
 * render: pass a service event directly, or wrap a combined event (`Event.any`) in `useMemo`.
 * A new event on each render means a new subscription on each render.
 * @param getValue Returns the current value.
 * @param equals Returns true when two values are the same. React needs the exact same value
 * back while nothing has changed, so a getter that builds a new array or object on each call
 * needs a comparison such as `arrays.equals`. Defaults to `===`.
 * @returns The current value.
 */
export function useExternalValue<T>(
	onDidChange: Event<unknown>,
	getValue: () => T,
	equals: (a: T, b: T) => boolean = (a, b) => a === b,
): T {
	const subscribe = useCallback((onStoreChange: () => void) => {
		const disposable = onDidChange(() => onStoreChange());
		return () => disposable.dispose();
	}, [onDidChange]);

	// The last value returned, so an equal value from the getter can be swapped for it.
	const lastValue = useRef<{ value: T } | undefined>(undefined);

	const getSnapshot = () => {
		const value = getValue();
		if (lastValue.current && equals(lastValue.current.value, value)) {
			return lastValue.current.value;
		}
		lastValue.current = { value };
		return value;
	};

	return useSyncExternalStore(subscribe, getSnapshot);
}
