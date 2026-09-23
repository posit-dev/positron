/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $ } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserOverlayManager, BrowserOverlayType } from '../../electron-browser/overlayManager.js';

suite('BrowserOverlayManager', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let manager: BrowserOverlayManager;
	let elements: HTMLElement[];

	function addElement(className: string, styles: Partial<CSSStyleDeclaration>, parent: HTMLElement = mainWindow.document.body): HTMLElement {
		const el = $(`.${className}`);
		Object.assign(el.style, styles);
		parent.appendChild(el);
		elements.push(el);
		return el;
	}

	setup(() => {
		elements = [];
		manager = store.add(new BrowserOverlayManager(mainWindow));
	});

	teardown(() => {
		for (const el of elements) {
			el.remove();
		}
		elements = [];
	});

	test('detects a modal overlay covering the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	test('does not detect an overlay that does not overlap the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '100px', height: '100px'
		});
		addElement('monaco-menu-container', {
			position: 'fixed', left: '500px', top: '500px', width: '100px', height: '100px', zIndex: '2575'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays, []);
	});

	test('detects an overlay beneath detached webview content', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		const contextView = addElement('context-view', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px'
		});
		addElement('overlay-anchor', {
			position: 'absolute', left: '0px', top: '0px', width: '200px', height: '200px'
		}, contextView);

		const overlayContent = addElement('webview-overlay-content', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px', zIndex: '1'
		});
		addElement('webview', {
			width: '100%', height: '100%'
		}, overlayContent);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Unknown]);
	});

	// Regression test for #321088: a context menu (e.g. the "Add Models"
	// dropdown) renders a full-screen `.context-view-block` inside `.context-view`
	// that stacks above an already-open modal. The block isn't a tracked overlay
	// class, but it's a descendant of the tracked `.context-view`, so the browser
	// must still be reported as obscured.
	test('detects obscuring when a context-view block covers the browser on top of a modal', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});

		// Modal sitting on top of (and fully covering) the browser.
		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		// Context menu anchored outside the browser, so its own rect doesn't overlap.
		const contextView = addElement('context-view', {
			position: 'fixed', left: '320px', top: '320px', width: '60px', height: '60px', zIndex: '2575'
		});
		// Full-screen mouse-blocking child, stacked above the modal.
		addElement('context-view-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '-1'
		}, contextView);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		// The transparent block is skipped, so the modal beneath it is topmost.
		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	test('detects obscuring when a context-view pointer block covers the browser on top of a modal', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});

		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const contextView = addElement('context-view', {
			position: 'fixed', left: '320px', top: '320px', width: '60px', height: '60px', zIndex: '2575'
		});
		addElement('context-view-pointerBlock', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2'
		}, contextView);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	// A notification toast fully covered by a modal must be reported as the
	// dialog, not the notification, so callers don't treat a hidden toast as
	// the active obscuring overlay.
	test('reports the dialog, not a notification covered by it', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('notification-toast-container', {
			position: 'fixed', left: '0px', top: '0px', width: '200px', height: '200px', zIndex: '2000'
		});
		addElement('monaco-modal-editor-block', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	// --- Start Positron ---
	test('detects a Positron modal popup covering the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('positron-modal-popup-container', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Menu]);
	});

	// Regression test: the popup box itself is positioned near its anchor and may not overlap
	// the browser container, but its `.positron-modal-popup-container` always fills the
	// workbench, so the container (not the inner box) must be what's tracked.
	test('detects a Positron modal popup container even when the popup box itself does not overlap', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		const popupContainer = addElement('positron-modal-popup-container', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});
		addElement('positron-modal-popup', {
			position: 'absolute', left: '350px', top: '350px', width: '20px', height: '20px'
		}, popupContainer);

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Menu]);
	});

	test('detects a Positron modal dialog covering the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('positron-modal-dialog-container', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});

	// Regression test: dialogs built on PositronDynamicModalDialog (e.g. Configure
	// LLM Providers, Data Connections) render a `.positron-dynamic-modal-dialog-box-container`,
	// a different container than the static `.positron-modal-dialog-container`.
	test('detects a Positron dynamic modal dialog covering the browser container', () => {
		const browserContainer = addElement('browser-container', {
			position: 'absolute', left: '0px', top: '0px', width: '300px', height: '300px'
		});
		addElement('positron-dynamic-modal-dialog-box-container', {
			position: 'fixed', left: '0px', top: '0px', width: '400px', height: '400px', zIndex: '2540'
		});

		const overlays = manager.getOverlappingOverlays(browserContainer);

		assert.deepStrictEqual(overlays.map(o => o.type), [BrowserOverlayType.Dialog]);
	});
	// --- End Positron ---
});
