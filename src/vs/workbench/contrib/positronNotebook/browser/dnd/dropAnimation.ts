/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface DropAnimationConfig {
	duration?: number;
	easing?: string;
	sideEffects?: () => void;
}

const DEFAULT_DROP_ANIMATION: Required<Omit<DropAnimationConfig, 'sideEffects'>> = {
	duration: 250,
	easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)', // Slight overshoot
};

/**
 * Animate element from current position to final position.
 * Returns a promise that resolves when animation completes.
 */
export async function animateDrop(
	element: HTMLElement,
	from: { x: number; y: number },
	to: { x: number; y: number },
	config: DropAnimationConfig = {}
): Promise<void> {
	const { duration, easing } = { ...DEFAULT_DROP_ANIMATION, ...config };
	const { sideEffects } = config;

	// Calculate delta
	const dx = to.x - from.x;
	const dy = to.y - from.y;

	// If already at destination, skip animation
	if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
		sideEffects?.();
		return;
	}

	// Apply initial transform (inverted)
	element.style.transform = `translate3d(${-dx}px, ${-dy}px, 0)`;
	element.style.transition = 'none';

	// Force reflow
	element.getBoundingClientRect();

	// Animate to final position
	element.style.transition = `transform ${duration}ms ${easing}`;
	element.style.transform = 'translate3d(0, 0, 0)';

	// Wait for animation to complete
	await new Promise<void>(resolve => {
		const handleEnd = () => {
			element.removeEventListener('transitionend', handleEnd);
			element.style.transform = '';
			element.style.transition = '';
			sideEffects?.();
			resolve();
		};
		element.addEventListener('transitionend', handleEnd);

		// Fallback timeout in case transitionend doesn't fire
		setTimeout(() => {
			element.removeEventListener('transitionend', handleEnd);
			element.style.transform = '';
			element.style.transition = '';
			sideEffects?.();
			resolve();
		}, duration + 50);
	});
}

/**
 * Get default drop animation configuration.
 */
export function getDefaultDropAnimationConfig(): Required<Omit<DropAnimationConfig, 'sideEffects'>> {
	return { ...DEFAULT_DROP_ANIMATION };
}
