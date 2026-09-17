/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

/**
 * Windows whose implicit focus is suppressed, with a count of suppressors.
 *
 * The workbench focuses the native window an element lives in whenever that
 * element is focused (`BaseWindow.enableWindowFocusOnElementFocus`) and
 * raises windows on macOS (`IHostService.moveTop`). Both reveal a window that
 * Canvas mode hid on purpose, and neither can tell: `document.visibilityState`
 * still reads visible for a natively hidden window while webviews move
 * between windows. Canvas mode registers its hidden windows here for as long
 * as they are hidden.
 */
const suppressed = new WeakMap<Window, number>();

/** Suppress implicit focus of `window` until the returned disposable is disposed. Nests. */
export function suppressImplicitWindowFocus(window: Window): IDisposable {
	suppressed.set(window, (suppressed.get(window) ?? 0) + 1);
	return toDisposable(() => {
		const count = (suppressed.get(window) ?? 1) - 1;
		if (count === 0) {
			suppressed.delete(window);
		} else {
			suppressed.set(window, count);
		}
	});
}

/** Whether focusing an element inside `window` may bring the window forward. */
export function canImplicitlyFocusWindow(window: Window): boolean {
	return !suppressed.has(window);
}
