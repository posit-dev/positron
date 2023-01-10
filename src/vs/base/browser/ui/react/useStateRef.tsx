/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';  // eslint-disable-line no-duplicate-imports

/**
 * useStateRef hook.
 * @param initialValue The initial value.
 * @returns This hook.
 */
export function useStateRef<T>(initialValue: T | (() => T)): [T, React.Dispatch<React.SetStateAction<T>>, React.MutableRefObject<T>] {
	// Hooks.
	const [value, setValue] = useState(initialValue);
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	}, [value]);

	// Return the hook.
	return [value, setValue, ref];
}
