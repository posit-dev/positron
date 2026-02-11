/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

export interface AutoScrollConfig {
	threshold: number;
	speed: number;
}

const DEFAULT_CONFIG: AutoScrollConfig = {
	threshold: 100, // 100px from edge (larger threshold for better UX)
	speed: 15,      // 15px per frame
};

/**
 * Calculate scroll delta based on pointer position relative to viewport edges.
 * Returns { x, y } deltas - positive values scroll right/down.
 */
export function calculateScrollDelta(
	position: { x: number; y: number },
	scrollContainer: HTMLElement | Window,
	config: AutoScrollConfig = DEFAULT_CONFIG
): { x: number; y: number } {
	const { threshold, speed } = config;

	let rect: DOMRect;
	if (scrollContainer === window) {
		rect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
	} else {
		rect = (scrollContainer as HTMLElement).getBoundingClientRect();
	}

	let deltaX = 0;
	let deltaY = 0;

	// Vertical scrolling
	if (position.y < rect.top + threshold) {
		// Near top edge - scroll up
		const distance = rect.top + threshold - position.y;
		deltaY = -Math.min(speed, speed * (distance / threshold));
	} else if (position.y > rect.bottom - threshold) {
		// Near bottom edge - scroll down
		const distance = position.y - (rect.bottom - threshold);
		deltaY = Math.min(speed, speed * (distance / threshold));
	}

	// Horizontal scrolling (for wide content)
	if (position.x < rect.left + threshold) {
		const distance = rect.left + threshold - position.x;
		deltaX = -Math.min(speed, speed * (distance / threshold));
	} else if (position.x > rect.right - threshold) {
		const distance = position.x - (rect.right - threshold);
		deltaX = Math.min(speed, speed * (distance / threshold));
	}

	return { x: deltaX, y: deltaY };
}

/**
 * Auto-scroll controller that runs during drag operations.
 * Uses continuous animation loop to scroll while cursor is at edge.
 */
export class AutoScrollController {
	private animationFrameId: number | null = null;
	private config: AutoScrollConfig;
	private scrollContainerRef: React.RefObject<HTMLElement> | null;
	private lastPosition: { x: number; y: number } | null = null;
	private isScrolling = false;

	constructor(
		scrollContainerRef: React.RefObject<HTMLElement> | null = null,
		config: Partial<AutoScrollConfig> = {}
	) {
		this.scrollContainerRef = scrollContainerRef;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	private getScrollContainer(): HTMLElement | Window {
		return this.scrollContainerRef?.current ?? window;
	}

	/**
	 * Start or update auto-scrolling based on pointer position.
	 * Call this on every pointer move during drag.
	 */
	update(position: { x: number; y: number }) {
		this.lastPosition = position;

		// Start continuous scroll loop if not already running
		if (!this.isScrolling) {
			this.isScrolling = true;
			this.scrollLoop();
		}
	}

	private scrollLoop = () => {
		if (!this.isScrolling || !this.lastPosition) {
			return;
		}

		const container = this.getScrollContainer();
		const delta = calculateScrollDelta(this.lastPosition, container, this.config);

		if (delta.x !== 0 || delta.y !== 0) {
			if (container === window) {
				window.scrollBy(delta.x, delta.y);
			} else {
				(container as HTMLElement).scrollLeft += delta.x;
				(container as HTMLElement).scrollTop += delta.y;
			}
			// Continue scrolling while there is non-zero delta
			this.animationFrameId = requestAnimationFrame(this.scrollLoop);
		} else {
			// Stop the loop when cursor is away from edges.
			// The next update() call will restart it if needed.
			this.isScrolling = false;
			this.animationFrameId = null;
		}
	};

	/**
	 * Stop auto-scrolling.
	 */
	stop() {
		this.isScrolling = false;
		this.lastPosition = null;
		if (this.animationFrameId !== null) {
			cancelAnimationFrame(this.animationFrameId);
			this.animationFrameId = null;
		}
	}

	/**
	 * Update the scroll container ref.
	 */
	setScrollContainerRef(ref: React.RefObject<HTMLElement> | null) {
		this.scrollContainerRef = ref;
	}

	/**
	 * Update the auto-scroll configuration (threshold and speed).
	 */
	setConfig(config: Partial<AutoScrollConfig>) {
		// Filter out undefined values so they don't overwrite existing defaults
		const defined = Object.fromEntries(
			Object.entries(config).filter(([, v]) => v !== undefined)
		);
		this.config = { ...this.config, ...defined };
	}
}
