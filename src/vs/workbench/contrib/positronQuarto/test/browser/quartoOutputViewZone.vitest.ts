/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { chooseHtmlRenderMode, isInertHtml, isWebviewOverlayShown } from '../../browser/quartoOutputViewZone.js';

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

describe('isInertHtml', () => {
	it('treats plain markup as inert', () => {
		expect(isInertHtml('<table><tr><td>1</td></tr></table>')).toBe(true);
	});

	it('treats a full inert document as inert', () => {
		expect(isInertHtml('<!doctype html><html><body><p>hi</p></body></html>')).toBe(true);
	});

	it('flags scripts, iframes, and inline handlers as active', () => {
		expect(isInertHtml('<div><script>run()</script></div>')).toBe(false);
		expect(isInertHtml('<iframe src="x"></iframe>')).toBe(false);
		expect(isInertHtml('<a href="javascript:go()">x</a>')).toBe(false);
		expect(isInertHtml('<button onclick="go()">x</button>')).toBe(false);
	});
});

// R HTML widgets (e.g. highcharter, leaflet) emit self-contained `text/html`
// with <script> tags. When such an output is restored from cache after a
// reload/reopen, no kernel session has reattached yet -- but the raw-HTML
// webview is built from the static HTML alone and needs no session, so it must
// still render as a webview rather than the escaped-text warning
// (posit-dev/positron#14559).
describe('chooseHtmlRenderMode', () => {
	const activeHtml = '<div><script>run()</script></div>';
	const inertHtml = '<table><tr><td>1</td></tr></table>';

	it('renders inert HTML inline regardless of webview service', () => {
		expect(chooseHtmlRenderMode(inertHtml, true)).toBe('inline');
		expect(chooseHtmlRenderMode(inertHtml, false)).toBe('inline');
	});

	it('routes active HTML through a webview whenever the service is available', () => {
		// This is the reload case: no session, but the service is present.
		expect(chooseHtmlRenderMode(activeHtml, true)).toBe('webview');
	});

	it('falls back to the warning only when no webview service exists', () => {
		expect(chooseHtmlRenderMode(activeHtml, false)).toBe('warning');
	});
});
