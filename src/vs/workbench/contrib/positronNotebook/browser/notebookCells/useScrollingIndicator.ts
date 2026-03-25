/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, type RefObject } from 'react';

/** CSS class toggled on scrollable elements while actively scrolling. */
export const SCROLLING_CSS_CLASS = 'is-scrolling';

/**
 * Delay before removing the scrolling indicator class after the last scroll
 * event, matching the VS Code custom scrollbar widget timeout.
 */
const SCROLLING_HIDE_TIMEOUT = 500;

/**
 * Adds an `is-scrolling` CSS class to the referenced element while it is being
 * scrolled. The class is removed after a short delay once scrolling stops,
 * allowing CSS transitions to fade the scrollbar thumb out gracefully.
 *
 * Uses direct classList mutation instead of React state to avoid re-rendering
 * the component tree on every scroll event. The class is purely visual (drives
 * a CSS scrollbar color) so React doesn't need to know about it.
 */
export function useScrollingIndicator(
	ref: RefObject<HTMLElement | null>
): void {
	useEffect(() => {
		const el = ref.current;
		if (!el) {
			return;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;

		const handleScroll = () => {
			el.classList.add(SCROLLING_CSS_CLASS);
			clearTimeout(timer);
			timer = setTimeout(() => el.classList.remove(SCROLLING_CSS_CLASS), SCROLLING_HIDE_TIMEOUT);
		};

		el.addEventListener('scroll', handleScroll);
		return () => {
			el.removeEventListener('scroll', handleScroll);
			clearTimeout(timer);
			el.classList.remove(SCROLLING_CSS_CLASS);
		};
	}, [ref]);
}
