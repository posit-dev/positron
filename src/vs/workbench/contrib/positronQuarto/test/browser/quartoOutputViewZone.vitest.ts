/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isWebviewOverlayShown } from '../../browser/quartoOutputViewZone.js';

// The inline-output webview is a fixed-position overlay anchored to a
// placeholder inside the editor view zone. It must be shown only while its view
// zone is on-screen; otherwise CSS anchor positioning falls back to a static
// position and the overlay "sticks" in the editor corner (see
// posit-dev/positron#13978).
//
// The predicate keys off Monaco's own `monaco-visible-view-zone` attribute
// rather than a geometry probe. Monaco sets/removes it in its render pass before
// calling `onDomNodeTop`, so it is fresh during scroll; a `getClientRects()`
// probe is one frame stale and, worse, stays truthy for a zone that has scrolled
// out of the viewport while Monaco still renders it -- exactly the flextable
// sticking case.
describe('isWebviewOverlayShown', () => {
	function zone(visible: boolean): HTMLElement {
		const el = document.createElement('div');
		if (visible) {
			el.setAttribute('monaco-visible-view-zone', 'true');
		}
		return el;
	}

	function anchor(connected: boolean): HTMLElement {
		const el = document.createElement('div');
		if (connected) {
			document.body.appendChild(el);
		}
		return el;
	}

	it('shows the overlay when the zone is on-screen and the anchor is attached', () => {
		expect(isWebviewOverlayShown(zone(true), anchor(true))).toBe(true);
	});

	it('hides the overlay when the zone has scrolled off-screen', () => {
		// Monaco removes the attribute for an off-screen zone even while the
		// placeholder is still in the DOM: this is the flextable sticking case.
		expect(isWebviewOverlayShown(zone(false), anchor(true))).toBe(false);
	});

	it('hides the overlay when the anchor is detached from the DOM', () => {
		expect(isWebviewOverlayShown(zone(true), anchor(false))).toBe(false);
	});
});
