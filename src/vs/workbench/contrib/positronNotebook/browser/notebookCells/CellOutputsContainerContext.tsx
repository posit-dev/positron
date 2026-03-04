/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

/**
 * Context that provides a ref to the cell outputs scroll container element.
 * The context value is the ref itself (stable identity), so changes to the
 * container's content do not cause context-driven re-renders.
 */
const CellOutputsContainerContext = React.createContext<React.RefObject<HTMLElement | null>>({ current: null });

export function CellOutputsContainerProvider({ containerRef, children }: {
	containerRef: React.RefObject<HTMLElement | null>;
	children: React.ReactNode;
}) {
	return <CellOutputsContainerContext.Provider value={containerRef}>{children}</CellOutputsContainerContext.Provider>;
}

/**
 * Returns whether the scroll container's content vertically overflows its
 * max-height. `null` means the container hasn't been measured yet (treat
 * as "assume overflow").
 *
 * On the initial render the container ref may not yet be assigned (React
 * processes layout effects bottom-up, so child effects fire before parent
 * refs are attached). The useEffect fallback handles this -- one frame of
 * scroll chrome at most. On subsequent renders the ref is populated, so
 * useLayoutEffect provides synchronous measurement with no flash.
 * ResizeObserver handles ongoing resize events (window resize, font size
 * change) that don't trigger a React render.
 */
export function useCellOutputsContainerOverflows(): boolean | null {
	const containerRef = React.useContext(CellOutputsContainerContext);
	const [overflows, setOverflows] = React.useState<boolean | null>(null);

	const measure = React.useCallback(() => {
		const el = containerRef.current;
		if (!el) { return; }
		setOverflows(el.scrollHeight > el.clientHeight);
	}, [containerRef]);

	// Synchronous measurement on every render. On re-renders the ref is
	// already populated, giving us a flash-free update. On the initial
	// render the ref is null (child effects fire before parent refs) so
	// this is a no-op --the useEffect fallback below handles that case.
	// No deps array: the measurement is cheap (two property reads) and
	// must re-run whenever children change the container's content height.
	// eslint-disable-next-line react-hooks/exhaustive-deps
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

	return overflows;
}
