/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { DependencyList, useRef, useEffect } from 'react';
import { IDisposable } from '../../../../base/common/lifecycle.js';

/**
 * Like `useEffect`, but for effects that return an {@link IDisposable}.
 *
 * Calls `effect()` when dependencies change, automatically disposing the
 * previous disposable before creating the next one.
 *
 * The `effect` callback is captured in a ref so it is always fresh -- only the
 * provided `deps` array controls when the effect re-runs.
 *
 * @param effect Factory that creates a disposable or `undefined`.
 * @param deps React dependency list that triggers re-creation.
 */
export function useDisposableEffect<T extends IDisposable>(effect: () => T | undefined, deps?: DependencyList): void {
	const effectRef = useRef(effect);
	effectRef.current = effect;

	useEffect(() => {
		const disposable = effectRef.current();
		return disposable ? () => disposable.dispose() : undefined;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, deps);
}
