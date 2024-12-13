/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useRef, useState } from 'react';

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
