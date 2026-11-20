/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The parts of a wheel event that determine how far the data grid scrolls.
 */
export interface WheelInput {
	readonly deltaX: number;
	readonly deltaY: number;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
}

/**
 * Horizontal and vertical scroll deltas, in pixels.
 */
export interface ScrollDeltas {
	readonly deltaX: number;
	readonly deltaY: number;
}

/**
 * Converts a wheel event into the scroll deltas the data grid applies.
 * @param e The wheel event.
 * @param isMacintosh Whether the platform is macOS.
 * @returns The scroll deltas.
 */
export function computeWheelScrollDeltas(e: WheelInput, isMacintosh: boolean): ScrollDeltas {
	// Get the delta X and delta Y.
	let deltaX = e.deltaX;
	let deltaY = e.deltaY;

	// Suppress jitter on the non-dominant wheel axis.
	{
		// This bias factor prevents minor input noise from falsely flipping axis dominance.
		const bias = 1.1;

		// Zero out the non-dominant axis.
		const absDeltaX = Math.abs(deltaX);
		const absDeltaY = Math.abs(deltaY);
		if (absDeltaX > absDeltaY * bias) {
			deltaY = 0;
		} else if (absDeltaY > absDeltaX * bias) {
			deltaX = 0;
		}
	}

	// When the shift key is held, convert vertical scrolling to horizontal scrolling. macOS does
	// this before the event arrives, so the event already carries delta X and swapping again would
	// scroll vertically (#3755). Windows and Linux deliver delta Y with the shift key set and leave
	// the conversion to the scroller (#11063). The !deltaX check leaves alone an event that a mouse
	// driver has already converted. This matches VS Code's ScrollableElement.
	if (e.shiftKey && !isMacintosh && !deltaX) {
		deltaX = deltaY;
		deltaY = 0;
	}

	// If the alt key is pressed, scroll by 10 times the delta X and delta Y.
	if (e.altKey) {
		deltaX *= 10;
		deltaY *= 10;
	}

	// Return the scroll deltas.
	return { deltaX, deltaY };
}
