/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Keeps a wheel event over a natively scrolling element from reaching the workbench container.
 *
 * On web, BrowserWindow (window.ts) calls preventDefault() on every wheel event that reaches the
 * workbench container, to block the macOS back/forward swipe gestures. That also cancels the
 * browser's native scrolling of any `overflow: auto` element inside the workbench. Stopping
 * propagation keeps the event from reaching that listener, so the browser scrolls the element
 * itself. On desktop, window.ts registers no such listener.
 *
 * Ctrl + wheel, and a pinch on a macOS touchpad, which Chromium delivers as ctrl + wheel, zooms
 * rather than scrolls. It is left to propagate, so window.ts keeps cancelling it and it does not
 * zoom the browser page.
 *
 * @param e The wheel event.
 * @returns true when the event was kept from the workbench and will scroll natively; false for
 * ctrl + wheel, which does not scroll.
 */
export function keepWheelFromWorkbench(e: { readonly ctrlKey: boolean; stopPropagation(): void }): boolean {
	if (e.ctrlKey) {
		return false;
	}

	e.stopPropagation();
	return true;
}
