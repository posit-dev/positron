/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { WebviewFrameId } from '../../../../../platform/webview/common/webviewManagerService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { ElectronPreviewOverlayWebview } from '../../electron-browser/previewOverlayWebview.js';

describe('ElectronPreviewOverlayWebview Viewer bridge', () => {
	const disposables = ensureNoLeakedDisposables();
	const contentFrame: WebviewFrameId = { processId: 11, routingId: 6, frameTreeNodeId: 42 };
	let app: HTMLIFrameElement;

	beforeEach(() => {
		app = mainWindow.document.body.appendChild(mainWindow.document.createElement('iframe'));
	});

	afterEach(() => {
		app.remove();
	});

	function createOverlay(overrides: Partial<IOverlayWebview>): ElectronPreviewOverlayWebview {
		return disposables.add(new ElectronPreviewOverlayWebview(stubInterface<IOverlayWebview>({
			onDidNavigate: Event.None,
			onDidDispose: Event.None,
			onDidLoad: Event.None,
			dispose: () => { },
			...overrides,
		})));
	}

	it('runs the bridge in the app\'s frame, and passes on its result or its error', async () => {
		app.contentDocument!.body.innerHTML = '<button>Go</button>';
		const frames: WebviewFrameId[] = [];
		const overlay = createOverlay({
			getContentFrameId: () => contentFrame,
			// Stands in for the main process, which runs the script in the frame.
			executeJavaScript: async (frameId, script) => {
				frames.push(frameId);
				return (app.contentWindow as Window & typeof globalThis).eval(script);
			},
		});

		const snapshot = await overlay.runBridge('snapshot');
		const failure = await overlay.runBridge('snapshot', { selector: '#missing' }).catch((error: Error) => error.message);

		expect({ text: snapshot.text, failure, frames }).toEqual({
			text: '- button "Go" [ref=e1]',
			failure: 'Nothing in the Viewer matches the selector "#missing".',
			frames: [contentFrame, contentFrame],
		});
	});

	it('reaches content set as HTML, such as Quarto output, from the webview\'s host frame', async () => {
		// The host frame's #active-frame holds the HTML string's srcdoc frame.
		const active = app.contentDocument!.body.appendChild(app.contentDocument!.createElement('iframe'));
		active.id = 'active-frame';
		const page = active.contentDocument!.body.appendChild(active.contentDocument!.createElement('iframe'));
		page.id = 'preview-iframe';
		page.contentDocument!.body.innerHTML = '<button>Go</button>';
		const hostFrame: WebviewFrameId = { processId: 11, routingId: 2, frameTreeNodeId: 7 };
		const frames: WebviewFrameId[] = [];
		const overlay = createOverlay({
			getContentFrameId: () => undefined,
			getHostFrameId: async () => hostFrame,
			executeJavaScript: async (frameId, script) => {
				frames.push(frameId);
				return (app.contentWindow as Window & typeof globalThis).eval(script);
			},
		});

		const snapshot = await overlay.runBridge('snapshot');

		expect({ text: snapshot.text, frames }).toEqual({ text: '- button "Go" [ref=e1]', frames: [hostFrame] });
	});

	it('says when there\'s no page to run in, or the page doesn\'t answer', async () => {
		const noFrame = createOverlay({ getContentFrameId: () => undefined, getHostFrameId: async () => undefined });
		// A URI's page has no frame until it loads, and the host frame holds an empty page meanwhile.
		const uriLoading = createOverlay({ getContentFrameId: () => undefined, setUri: () => { } });
		uriLoading.loadUri(URI.parse('http://localhost:8000/'));
		const noAnswer = createOverlay({ getContentFrameId: () => contentFrame, executeJavaScript: async () => undefined });

		expect([
			await noFrame.runBridge('viewport').catch((error: Error) => error.message),
			await uriLoading.runBridge('viewport').catch((error: Error) => error.message),
			await noAnswer.runBridge('viewport').catch((error: Error) => error.message),
		]).toEqual([
			'The Viewer\'s content hasn\'t loaded yet.',
			'The Viewer\'s content hasn\'t loaded yet.',
			'The Viewer\'s content didn\'t respond.',
		]);
	});
});
