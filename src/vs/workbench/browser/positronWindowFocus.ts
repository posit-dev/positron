/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from '../../base/common/lifecycle.js';

const suppressed = new WeakMap<Window, number>();

/** Native hide/show and document.visibilityState can disagree during webview moves. */
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

export function canImplicitlyFocusWindow(window: Window): boolean {
	return !suppressed.has(window);
}
