/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { PreviewOverlayWebview } from '../../browser/previewOverlayWebview.js';

describe('PreviewOverlayWebview Viewer bridge (web)', () => {
	const disposables = ensureNoLeakedDisposables();
	const QUICK = { quietMs: 10, timeoutMs: 1000 };
	let container: HTMLElement;

	beforeEach(() => {
		container = mainWindow.document.body.appendChild(mainWindow.document.createElement('div'));
	});

	afterEach(() => {
		container.remove();
	});

	function addFrame(parent: Element, id?: string): HTMLIFrameElement {
		const frame = parent.ownerDocument.createElement('iframe');
		if (id) {
			frame.id = id;
		}
		return parent.appendChild(frame);
	}

	/** Builds the webview's frames as web builds have them, with `html` as the app's page. */
	function showApp(html: string): HTMLIFrameElement {
		const active = addFrame(addFrame(container).contentDocument!.body, 'active-frame');
		addFrame(active.contentDocument!.body, 'preview-iframe').contentDocument!.body.innerHTML = html;
		return active;
	}

	function createOverlay(): PreviewOverlayWebview {
		return disposables.add(new PreviewOverlayWebview(stubInterface<IOverlayWebview>({
			onDidNavigate: Event.None,
			onDidDispose: Event.None,
			onDidLoad: Event.None,
			dispose: () => { },
			container,
		})));
	}

	it('runs the bridge against the app\'s page, keeping refs from one call to the next', async () => {
		showApp('<button>Go</button>');
		const overlay = createOverlay();

		const snapshot = await overlay.runBridge('snapshot');
		const outcome = await overlay.runBridge('act', { kind: 'click', ref: 'e1' }, QUICK);

		expect({ text: snapshot.text, message: outcome.message }).toEqual({ text: '- button "Go" [ref=e1]', message: 'Clicked the button "Go".' });
	});

	it('reads a new page in the Viewer afresh, so refs from the old page don\'t act on it', async () => {
		const active = showApp('<button>Go</button>');
		const overlay = createOverlay();
		await overlay.runBridge('snapshot');
		active.contentDocument!.body.replaceChildren();
		addFrame(active.contentDocument!.body, 'preview-iframe').contentDocument!.body.innerHTML = '<button>Next</button>';

		await expect(overlay.runBridge('act', { kind: 'click', ref: 'e1' }, QUICK)).rejects.toThrow('There\'s no control e1 on this page.');
		expect((await overlay.runBridge('snapshot')).text).toBe('- button "Next" [ref=e1]');
	});

	it('says why it can\'t reach the app\'s page', async () => {
		const overlay = createOverlay();
		const outer = addFrame(container).contentDocument!;
		const notLoaded = await overlay.runBridge('viewport').catch((error: Error) => error.message);
		addFrame(outer.body, 'active-frame');
		const noApp = await overlay.runBridge('viewport').catch((error: Error) => error.message);

		expect([notLoaded, noApp]).toEqual(['The Viewer\'s content hasn\'t loaded yet.', 'Agents can\'t read this kind of Viewer content yet.']);
	});
});
