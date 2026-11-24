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
 * Comparing the two deltas, rather than requiring delta X to be zero, lets a touchpad gesture with
 * a little horizontal noise convert like a mouse wheel, while an event that is already mostly
 * horizontal (converted by the platform, the browser, or a mouse driver) is left unchanged.
 *
 * The function's source is also injected into webview outputs (see webviewMessageCode in
 * positronWebviewPreloads/browser/notebookOutputUtils.ts), so it must not reference anything
 * outside itself.
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
