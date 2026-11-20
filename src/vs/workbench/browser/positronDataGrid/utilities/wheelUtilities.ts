/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { shiftWheelToHorizontal, WheelDeltas } from '../../../../base/common/positronWheel.js';

/**
 * The parts of a wheel event that determine how far the data grid scrolls.
 */
interface WheelInput extends WheelDeltas {
	readonly shiftKey: boolean;
	readonly altKey: boolean;
}

/**
 * Converts a wheel event into the scroll deltas the data grid applies.
 * @param e The wheel event.
 * @param isMacintosh Whether the platform is macOS.
 * @returns The scroll deltas, in the units of the wheel event.
 */
export function computeWheelScrollDeltas(e: WheelInput, isMacintosh: boolean): WheelDeltas {
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

	// When the shift key is held, convert vertical scrolling to horizontal scrolling.
	({ deltaX, deltaY } = shiftWheelToHorizontal({ deltaX, deltaY, shiftKey: e.shiftKey }, isMacintosh));

	// If the alt key is pressed, scroll by 10 times the delta X and delta Y.
	if (e.altKey) {
		deltaX *= 10;
		deltaY *= 10;
	}

	// Return the scroll deltas.
	return { deltaX, deltaY };
}
