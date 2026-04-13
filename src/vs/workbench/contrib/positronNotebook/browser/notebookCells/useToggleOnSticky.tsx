/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useLayoutEffect, type RefObject } from 'react';
import { getWindow } from '../../../../../base/browser/dom.js';

/**
 * Toggles a CSS class on an element when its parent (`position: sticky`)
 * container is pinned to the scrollport.
 *
 * A zero-height sentinel is inserted in normal flow right before the sticky
 * container. An `IntersectionObserver` (with `root: null`) watches the
 * sentinel. The observer clips the sentinel's bounds against every ancestor
 * `overflow` container before checking the viewport, so it correctly detects
 * when the sentinel scrolls past the edge of a nested scroll container --
 * not just the outer viewport.
 *
 * While the sticky container is in its natural position both it and the
 * sentinel sit at the same place and the sentinel is "intersecting."
 * When the user scrolls far enough for the container to stick, the sentinel
 * continues scrolling, gets clipped by the `overflow: auto` ancestor, and
 * the observer fires with `isIntersecting: false` -- meaning "stuck."
 *
 * @param elementRef - Ref to the element that should receive the class
 * @param classNameForWhenSticky - Class added while stuck, removed otherwise
 */
export function useToggleOnSticky(
	elementRef: RefObject<HTMLElement | null>,
	classNameForWhenSticky: string,
): void {
	useLayoutEffect(() => {
		const el = elementRef.current;
		if (!el || classNameForWhenSticky.length === 0) {
			return;
		}

		// The sticky container is the direct parent of the target element.
		const stickyContainer = el.parentElement;
		if (!stickyContainer?.parentElement) {
			return;
		}

		const win = getWindow(el);

		// Sentinel: sits in normal flow right before the sticky container
		// so it tracks the container's would-be static position.
		const sentinel = win.document.createElement('div');
		sentinel.style.height = '0';
		sentinel.style.visibility = 'hidden';
		sentinel.style.pointerEvents = 'none';
		stickyContainer.parentElement.insertBefore(sentinel, stickyContainer);

		// The observer clips against all ancestor overflow containers.
		// When the sentinel is still within the scroll container's bounds
		// it is "intersecting" -- the sticky container is not stuck.
		// Once scrolled past the clip edge of the overflow ancestor the
		// sentinel area drops to zero, isIntersecting becomes false,
		// and we know the sticky container is stuck.
		const observer = new win.IntersectionObserver(
			([entry]) => {
				el.classList.toggle(classNameForWhenSticky, !entry.isIntersecting);
			},
			{ threshold: [0] },
		);
		observer.observe(sentinel);

		return () => {
			observer.disconnect();
			sentinel.remove();
			el.classList.remove(classNameForWhenSticky);
		};
	}, [elementRef, classNameForWhenSticky]);
}
