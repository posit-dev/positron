/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useLayoutEffect } from 'react';

/**
 * Hook to observe scroll events on a container element
 * Fires the callback on scroll, DOM mutations, and initial mount
 */
export function useScrollObserver(
	containerRef: React.RefObject<HTMLElement>,
	onScroll: () => void
): void {
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		// Fire initial scroll event
		onScroll();

		// Set up scroll listener
		const handleScroll = () => onScroll();
		container.addEventListener('scroll', handleScroll);

		// Set up mutation observer for DOM changes
		const observer = new MutationObserver(() => {
			// Use requestAnimationFrame for better performance
			requestAnimationFrame(() => onScroll());
		});

		observer.observe(container, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['style', 'class']
		});

		return () => {
			container.removeEventListener('scroll', handleScroll);
			observer.disconnect();
		};
	}, [containerRef, onScroll]);
}
