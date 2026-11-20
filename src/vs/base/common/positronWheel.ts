/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Horizontal and vertical wheel deltas, in the units of the wheel event they came from.
 */
export interface WheelDeltas {
	readonly deltaX: number;
	readonly deltaY: number;
}

/**
 * Converts vertical wheel scrolling to horizontal scrolling when the shift key is held, for code
 * that applies wheel deltas itself instead of leaving the scroll to the browser.
 *
 * macOS does this conversion before the event arrives, so the event already carries delta X, and
 * converting again would scroll vertically (#3755). Windows and Linux deliver delta Y with the
 * shift key set and leave the conversion to the scroller (#11063).
 *
 * The event is converted when delta Y is at least as large as delta X, and the smaller delta X is
 * dropped, so a touchpad gesture with a little horizontal noise converts the same way a mouse
 * wheel does. An event that is mostly horizontal, because the platform, the browser, or a mouse
 * driver already converted it, is left alone. This is what VS Code's ScrollableElement does with
 * its default scrollPredominantAxis: it zeroes the smaller axis, then applies the shift rule.
 * @param e The wheel event, or its deltas and shift key state.
 * @param isMacintosh Whether the platform is macOS.
 * @returns The deltas to scroll by.
 */
export function shiftWheelToHorizontal(e: WheelDeltas & { readonly shiftKey: boolean }, isMacintosh: boolean): WheelDeltas {
	if (e.shiftKey && !isMacintosh && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
		return { deltaX: e.deltaY, deltaY: 0 };
	}
	return { deltaX: e.deltaX, deltaY: e.deltaY };
}
