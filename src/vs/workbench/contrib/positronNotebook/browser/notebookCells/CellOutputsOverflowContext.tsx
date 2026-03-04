/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

/**
 * Context that provides whether the cell outputs scroll container's content
 * vertically overflows its max-height. `null` means not yet measured (treat
 * as "assume overflow"). Measurement is performed once in the provider so
 * multiple consumers share a single ResizeObserver.
 */
const CellOutputsOverflowContext = React.createContext<boolean | null>(null);

/**
 * Provides overflow state for a cell outputs scroll container. Measures once
 * via a single ResizeObserver and exposes the result through context.
 *
 * On the initial render the container ref may not yet be assigned (React
 * processes layout effects bottom-up, so child effects fire before parent
 * refs are attached). The useEffect fallback handles this -- one frame of
 * scroll chrome at most. On subsequent renders the ref is populated, so
 * useLayoutEffect provides synchronous measurement with no flash.
 * ResizeObserver handles ongoing resize events (window resize, font size
 * change) that don't trigger a React render.
 */
export function CellOutputsOverflowProvider({ containerRef, children }: {
	containerRef: React.RefObject<HTMLElement | null>;
	children: React.ReactNode;
}) {
	const [overflows, setOverflows] = React.useState<boolean | null>(null);

	const measure = React.useCallback(() => {
		const el = containerRef.current;
		if (!el) { return; }
		setOverflows(el.scrollHeight > el.clientHeight);
	}, [containerRef]);

	// Synchronous measurement on every render. On re-renders the ref is
	// already populated, giving us a flash-free update. On the initial
	// render the ref is null (child effects fire before parent refs) so
	// this is a no-op -- the useEffect fallback below handles that case.
	// No deps array: the measurement is cheap (two property reads) and
	// must re-run whenever children change the container's content height.
	React.useLayoutEffect(measure);

	// Fallback for the initial render when the ref isn't assigned yet
	// during useLayoutEffect, plus ResizeObserver for external resizes.
	React.useEffect(() => {
		measure();
		const el = containerRef.current;
		if (!el) { return; }
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	}, [containerRef, measure]);

	return <CellOutputsOverflowContext.Provider value={overflows}>{children}</CellOutputsOverflowContext.Provider>;
}

/**
 * Returns whether the scroll container's content vertically overflows its
 * max-height. `null` means the container hasn't been measured yet (treat
 * as "assume overflow").
 */
export function useCellOutputsContainerOverflows(): boolean | null {
	return React.useContext(CellOutputsOverflowContext);
}
