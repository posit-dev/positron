/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { externalUriToString } from '../../../../base/common/positronUtilities.js';
import { htmlAttributeEncodeValue } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IViewerBridge } from '../common/positronViewerAgent.js';
import { createViewerBridge } from './viewerBridge.js';
import { captureDomScreenshot, IViewerCapture } from './viewerScreenshot.js';

/**
 * The Viewer bridges created for app pages in web builds, one per document so
 * that a page load gets a fresh bridge.
 */
const viewerBridges = new WeakMap<Document, IViewerBridge>();

/**
 * The result of a call to a Viewer bridge method.
 */
export type ViewerBridgeResult<M extends keyof IViewerBridge> = Awaited<ReturnType<IViewerBridge[M]>>;

export class PreviewOverlayWebview extends Disposable {

	public onDidNavigate = this.webview.onDidNavigate;
	public onDidDispose = this.webview.onDidDispose;
	public onDidLoad = this.webview.onDidLoad;

	private _title: string | undefined;

	constructor(public readonly webview: IOverlayWebview) {
		super();
		this._register(webview);
		// The script that reports loads runs in the app's page, so an empty title
		// means the page has none.
		this._register(webview.onDidLoad(title => {
			this._title = title || undefined;
		}));
	}

	/**
	 * The title of the page loaded in the webview, if it has one.
	 */
	public get title(): string | undefined {
		return this._title;
	}

	public setTitle(value: string): void {
		this.webview.setTitle(value);
	}

	public postMessage(message: any, transfer?: readonly ArrayBuffer[]): Promise<boolean> {
		return this.webview.postMessage(message, transfer);
	}

	/**
	 * Loads a URI in the internal webview.
	 *
	 * @param uri The URI to load
	 */
	public loadUri(uri: URI): void {
		// Forget the last page's title; the new page reports its own when it loads.
		this._title = undefined;
		this.loadUriInWebview(uri);
	}

	/**
	 * Loads a URI in the internal webview, in an iframe.
	 *
	 * This is overridden in the Electron implementation to use the webview's
	 * `setUri` method, which has native support for loading URIs.
	 *
	 * @param uri The URI to load
	 */
	protected loadUriInWebview(uri: URI): void {
		// This Preview pane HTML is roughly equivalent to src/vs/workbench/contrib/positronHelp/browser/resources/help.html
		// for the Help pane.
		this.webview.setHtml(`
		<html>
			<head>
				<style>
					html, body {
						padding: 0;
						margin: 0;
						height: 100%;
						min-height: 100%;
					}
					iframe {
						width: 100%;
						height: 100%;
						border: none;
						display: block;
					}
				</style>
			</head>
			<body>
				<iframe id="preview-iframe" title="Preview Content" src="${htmlAttributeEncodeValue(externalUriToString(uri))}"></iframe>
				<script async type="module">
					// Get a reference to the VS Code API
					const vscode = acquireVsCodeApi();

					// Get the preview iframe content window
					const previewContentWindow = document.getElementById("preview-iframe").contentWindow;

					// Listen for messages
					window.addEventListener('message', message => {
						if (message.source === previewContentWindow && message.data.channel !== 'execCommand') {
							// If a message is coming from the preview content window, forward it to the
							// preview overlay webview.
							vscode.postMessage({
								__positron_preview_message: true,
								...message.data
							});
						} else {
							// Forward messages from the preview overlay webview to the preview content window.
							// Messages may include commands to navigate back, forward, reload, etc.,
							// via the 'execCommand' channel.
							previewContentWindow.postMessage(message.data, '*');
						}
					});
				</script>
			</body>
		</html>`);
	}

	/**
	 * Calls a Viewer bridge method against the page showing in the webview.
	 *
	 * In web builds, the webview's frames are served from Positron's own
	 * origin, so the bridge runs here and reaches into the app's frame
	 * directly. Nothing is injected into the app. The Electron implementation
	 * runs the bridge in the app's frame through the main process instead.
	 *
	 * @param method The bridge method to call.
	 * @param args The method's arguments.
	 */
	public async runBridge<M extends keyof IViewerBridge>(method: M, ...args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		const appWindow = this.getAppWindow();
		let bridge = viewerBridges.get(appWindow.document);
		if (!bridge) {
			bridge = createViewerBridge(appWindow);
			viewerBridges.set(appWindow.document, bridge);
		}
		const call = bridge[method] as (...args: Parameters<IViewerBridge[M]>) => ReturnType<IViewerBridge[M]>;
		return await call(...args);
	}

	/**
	 * Takes a screenshot of what's on screen in the webview. In web builds it's
	 * rebuilt from the app's page; the Electron implementation captures the
	 * screen instead. The webview must be showing.
	 */
	public captureScreenshot(): Promise<IViewerCapture> {
		return captureDomScreenshot(this.getAppWindow(), getWindow(this.webview.container));
	}

	/**
	 * Gets the window of the page showing in the webview, through its
	 * same-origin frames: the webview's iframe, its #active-frame, then the
	 * #preview-iframe that loadUri creates.
	 */
	private getAppWindow(): Window & typeof globalThis {
		// The webview builds these frames itself (webview/browser/pre/index.html
		// and loadUri above), so there are no element references to them.
		// eslint-disable-next-line no-restricted-syntax
		const outer = this.webview.container.querySelector('iframe');
		const outerDocument = outer?.contentDocument;
		if (outer && !outerDocument) {
			throw new Error('Positron can\'t read the Viewer\'s content, because the Viewer is served from a different origin than Positron.');
		}
		// eslint-disable-next-line no-restricted-syntax
		const active = outerDocument?.querySelector<HTMLIFrameElement>('#active-frame');
		if (!active?.contentDocument) {
			throw new Error('The Viewer\'s content hasn\'t loaded yet.');
		}
		// eslint-disable-next-line no-restricted-syntax
		const app = active.contentDocument.querySelector<HTMLIFrameElement>('#preview-iframe');
		if (!app) {
			throw new Error('Agents can\'t read this kind of Viewer content yet.');
		}
		const appWindow = app.contentWindow;
		if (!appWindow || !app.contentDocument) {
			throw new Error('Positron can\'t read the Viewer\'s content, because the page is served from a different origin than Positron.');
		}
		return appWindow as Window & typeof globalThis;
	}
}
