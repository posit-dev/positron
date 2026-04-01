/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, type RefObject } from 'react';

/**
 * Forwards wheel events from `sourceRef` to `targetRef` so that scrolling
 * works even when the cursor is over an overlay like an action bar.
 * Only prevents default if the scroll position actually changed, so that
 * parent scrolling kicks in at boundaries.
 */
export function useWheelForwarding(
	sourceRef: RefObject<HTMLElement | null>,
	targetRef: RefObject<HTMLElement | null>,
) {
	useEffect(() => {
		const source = sourceRef.current;
		if (!source) {
			return;
		}
		const handleWheel = (e: WheelEvent) => {
			const scrollable = targetRef.current;
			if (scrollable) {
				const prevTop = scrollable.scrollTop;
				const prevLeft = scrollable.scrollLeft;
				scrollable.scrollTop += e.deltaY;
				scrollable.scrollLeft += e.deltaX;
				if (scrollable.scrollTop !== prevTop || scrollable.scrollLeft !== prevLeft) {
					e.preventDefault();
				}
			}
		};
		source.addEventListener('wheel', handleWheel, { passive: false });
		return () => source.removeEventListener('wheel', handleWheel);
	}, [sourceRef, targetRef]);
}
