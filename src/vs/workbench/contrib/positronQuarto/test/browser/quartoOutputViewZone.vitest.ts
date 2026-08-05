/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../../base/common/event.js';
import { BareFontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICellOutput } from '../../common/quartoExecutionTypes.js';
import { chooseHtmlRenderMode, getImageDataUrl, isInertHtml, isWebviewOverlayShown, QuartoOutputViewZone } from '../../browser/quartoOutputViewZone.js';
import { decodeImageDataUrl } from '../../../../services/positronPlots/common/imageDataUrl.js';

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

// Kernels provide raster image payloads as base64 and SVG payloads as raw
// markup. Both formats must produce data URLs supported by the shared decoder.
describe('getImageDataUrl', () => {
	const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';

	it('URL-encodes SVG payloads rather than labelling them base64', () => {
		const dataUrl = getImageDataUrl('image/svg+xml', svg);
		expect(dataUrl.startsWith('data:image/svg+xml,')).toBe(true);
	});

	it('produces an SVG data URL the shared decoder round-trips', () => {
		const decoded = decodeImageDataUrl(getImageDataUrl('image/svg+xml', svg));
		expect({ mimeType: decoded?.mimeType, data: decoded?.data.toString() })
			.toEqual({ mimeType: 'image/svg+xml', data: svg });
	});

	it('labels raster payloads as base64', () => {
		expect(getImageDataUrl('image/png', 'aGVsbG8=')).toBe('data:image/png;base64,aGVsbG8=');
	});

	it('returns a payload that is already a data URL unchanged', () => {
		expect(getImageDataUrl('image/png', 'data:image/png;base64,aGVsbG8=')).toBe('data:image/png;base64,aGVsbG8=');
	});
});

// A cell's output can arrive hundreds of ms after the user collapsed it, while
// the zone is still in its recomputing window. Expanding on fresh output is the
// default so new results are visible, but doing it after an explicit collapse
// discards the user's action and inverts the next toggle: the following toggle
// reads the collapsed flag as false and collapses again instead of expanding.
// That is the quarto-inline-output-collapse flake (posit-dev/positron#15205).
//
// These drive the real view zone rather than the collapse predicate on its own:
// the bug was never in the predicate but in the ordering of setRecomputing /
// setCollapsed / addOutput around it, so the sequence is what has to be pinned.
describe('QuartoOutputViewZone collapse across a re-execution', () => {
	function createViewZone(): QuartoOutputViewZone {
		const containerDomNode = document.createElement('div');
		const editor = stubInterface<ICodeEditor>({
			getContainerDomNode: () => containerDomNode,
			onDidChangeConfiguration: Event.None,
			onDidLayoutChange: Event.None,
			onDidScrollChange: Event.None,
			onDidContentSizeChange: Event.None,
			onDidChangeHiddenAreas: Event.None,
			onMouseMove: Event.None,
			onMouseLeave: Event.None,
			// The zone reads only fontInfo, and only hands it to `applyFontInfo`,
			// which takes a BareFontInfo. Throwing on any other option keeps the
			// stub honest if the zone starts reading more of the editor config.
			getOption: ((id: EditorOption) => {
				if (id !== EditorOption.fontInfo) {
					throw new Error(`unexpected getOption(${id})`);
				}
				return BareFontInfo._create('monospace', 'normal', 12, '', '', 18, 0, 1, false);
			}) as ICodeEditor['getOption'],
		});
		return new QuartoOutputViewZone(editor, 'cell-1', 1);
	}

	function textOutput(id: string, text: string): ICellOutput {
		return { outputId: id, items: [{ mime: 'text/plain', data: text }] };
	}

	it('keeps the output collapsed when the user collapses mid-execution', () => {
		const zone = createViewZone();
		zone.addOutput(textOutput('out-1', 'first run'));

		// Re-run: the zone enters recomputing while the old output is still shown.
		zone.setRecomputing(true);
		// The user collapses during that window.
		zone.toggleCollapsed();
		expect(zone.isCollapsed).toBe(true);

		// The new output lands hundreds of ms later. It must not undo the collapse.
		zone.addOutput(textOutput('out-2', 'second run'));
		expect(zone.isCollapsed).toBe(true);

		// And the next toggle expands, rather than collapsing a second time.
		zone.toggleCollapsed();
		expect(zone.isCollapsed).toBe(false);

		zone.dispose();
	});

	it('expands on fresh output when the collapse predates the re-execution', () => {
		const zone = createViewZone();
		zone.addOutput(textOutput('out-1', 'first run'));

		// Collapsed while idle, before anything re-runs.
		zone.toggleCollapsed();
		expect(zone.isCollapsed).toBe(true);

		// This is the case the auto-expand exists for: new results become visible.
		zone.setRecomputing(true);
		zone.addOutput(textOutput('out-2', 'second run'));
		expect(zone.isCollapsed).toBe(false);

		zone.dispose();
	});
});
