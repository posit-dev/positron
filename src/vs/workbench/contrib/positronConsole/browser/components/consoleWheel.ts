/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { shiftWheelToHorizontal, WheelDeltas } from '../../../../../base/common/positronWheel.js';

/**
 * Determines whether a wheel event scrolls the console up, which engages scroll lock (the console
 * stops following new output). Shift + wheel scrolls horizontally on Windows and Linux, so it
 * does not count as scrolling up there.
 * @param e The wheel event, or its deltas and shift key state.
 * @param isMacintosh Whether the platform is macOS.
 * @returns true if the event scrolls up; otherwise, false.
 */
export function isWheelScrollUp(e: WheelDeltas & { readonly shiftKey: boolean }, isMacintosh: boolean): boolean {
	return shiftWheelToHorizontal(e, isMacintosh).deltaY < 0;
}
