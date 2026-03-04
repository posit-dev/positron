/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

interface CellOutputsContainerState {
	/** Ref to attach to the scroll container element. */
	containerRef: React.RefObject<HTMLElement | null>;
	/** Whether the container's content overflows its max-height. */
	overflows: boolean;
}

const CellOutputsContainerContext = React.createContext<CellOutputsContainerState>({
	containerRef: { current: null },
	overflows: true,
});

/**
 * Observes the container element referenced by `containerRef` and provides
 * overflow state to descendant components. Attach the ref to the scroll
 * container element.
 *
 * Uses useLayoutEffect for synchronous initial measurement (to avoid a
 * visible flash of scroll chrome) and ResizeObserver for ongoing changes.
 */
export function CellOutputsContainerProvider({
	containerRef,
	children,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	children: React.ReactNode;
}) {
	const [overflows, setOverflows] = React.useState(true);

	// Synchronous measurement after children change. Runs after all children's
	// DOM mutations are committed but before the browser paints, so there
	// is no visible flash when content fits within the max-height.
	// `children` changes identity when the subtree re-renders with new content.
	React.useLayoutEffect(() => {
		const el = containerRef.current;
		if (!el) { return; }
		setOverflows(el.scrollHeight > el.clientHeight);
	}, [containerRef, children]);

	// Async observation for resize events (window resize, font size change,
	// etc.) that don't trigger a React render.
	React.useEffect(() => {
		const el = containerRef.current;
		if (!el) { return; }
		const observer = new ResizeObserver(() => {
			setOverflows(el.scrollHeight > el.clientHeight);
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [containerRef]);

	const value = React.useMemo(() => ({ containerRef, overflows }), [containerRef, overflows]);

	return <CellOutputsContainerContext.Provider value={value}>{children}</CellOutputsContainerContext.Provider>;
}

export function useCellOutputsContainer(): CellOutputsContainerState {
	return React.useContext(CellOutputsContainerContext);
}
