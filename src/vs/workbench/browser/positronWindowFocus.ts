/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

/**
 * Windows whose implicit window raise is suppressed, with a count of
 * suppressors.
 *
 * The workbench raises the native window an element lives in whenever that
 * element is focused (`BaseWindow.enableWindowFocusOnElementFocus`) and
 * raises windows on macOS (`IHostService.moveTop`). Both reveal a window that
 * Canvas mode hid on purpose, and neither can tell: `document.visibilityState`
 * still reads visible for a natively hidden window while webviews move
 * between windows. Canvas mode registers its hidden windows here for as long
 * as they are hidden. Only the window raise is suppressed; the element inside
 * the hidden window still receives focus.
 */
const suppressed = new WeakMap<Window, number>();

/** Suppress the implicit raise of `window` until the returned disposable is disposed. Nests. */
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

/** Whether focusing an element inside `window` may raise the window. */
export function canImplicitlyFocusWindow(window: Window): boolean {
	return !suppressed.has(window);
}
