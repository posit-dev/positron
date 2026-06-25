/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { Event } from '../../../common/event.js';

/**
 * Subscribes to an `Event` and returns its latest value as React state.
 * Pass `initialState` to read the current value before the first event fires.
 *
 * @example
 * // Track the runtime startup phase, initialized to the current phase.
 * const startupPhase = useEventState(
 *     services.languageRuntimeService.onDidChangeRuntimeStartupPhase,
 *     () => services.languageRuntimeService.startupPhase,
 * );
 */
export function useEventState<T>(
	event: Event<T> | undefined,
	initialState: () => T,
): T {
	const [value, setValue] = useState<T>(() => initialState());
	// Keep a ref so the effect always calls the latest initialState without
	// needing it as a dependency (avoids re-subscribing on every render).
	const initialStateRef = useRef(initialState);
	initialStateRef.current = initialState;

	useEffect(() => {
		// Re-read current state on every subscription so we don't miss updates
		// that arrived between the last render and this effect running.
		setValue(initialStateRef.current());

		if (!event) {
			return;
		}

		const disposable = event(newValue => setValue(newValue));
		return () => disposable.dispose();
	}, [event]);

	return value;
}
