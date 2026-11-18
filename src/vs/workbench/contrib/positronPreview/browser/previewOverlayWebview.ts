/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveElement, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { raceCancellation } from '../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { externalUriToString } from '../../../../base/common/positronUtilities.js';
import { htmlAttributeEncodeValue } from '../../../../base/common/strings.js';
import { URI } from '../../../../base/common/uri.js';
import { IOverlayWebview } from '../../webview/browser/webview.js';
import { IViewerBridge, IViewerRect } from '../common/positronViewerAgent.js';
import { createViewerBridge, findViewerContentWindow } from './viewerBridge.js';
import { captureDomScreenshot, IViewerCapture } from './viewerScreenshot.js';
import { BROWSER_ONLY_MESSAGE, CONSOLE_LOGS_UNAVAILABLE_MESSAGE, FULL_PAGE_UNAVAILABLE_MESSAGE, IPreviewCaptureOptions, IPreviewSurface, VIEWER_CONTENT_CHANGED_MESSAGE, ViewerBridgeResult } from './previewSurface.js';

/**
 * The Viewer bridges created for app pages in web builds, one per document so
 * that a page load gets a fresh bridge.
 */
const viewerBridges = new WeakMap<Document, IViewerBridge>();

export class PreviewOverlayWebview extends Disposable implements IPreviewSurface {

	public readonly kind = 'webview';

	public onDidNavigate = this.webview.onDidNavigate;
	public onDidDispose = this.webview.onDidDispose;
	public onDidLoad = this.webview.onDidLoad;

	private _title: string | undefined;

	/** The element the webview is laid out over, while claimed. */
	private _anchor: HTMLElement | undefined;

	/** Cancelled when the webview is disposed, as when other content replaces it in the Viewer. */
	private readonly _disposed = new CancellationTokenSource();

	/**
	 * Whether the webview has loaded a URI, rather than content set with
	 * setHtml (HTML strings and notebook output). A preview keeps one kind.
	 */
	protected loadedUri = false;

	constructor(public readonly webview: IOverlayWebview) {
		super();
		// Disposing the webview cancels _disposed, so dispose it first.
		this._register(webview);
		this._register(webview.onDidDispose(() => this._disposed.cancel()));
		this._register(this._disposed);
		// The script that reports loads runs in the app's page, so an empty title
		// means the page has none.
		this._register(webview.onDidLoad(title => {
			this._title = title || undefined;
		}));
	}

	public get title(): string | undefined {
		return this._title;
	}

	public setTitle(value: string): void {
		this.webview.setTitle(value);
	}

	public goBack(): void {
		this.execCommand('navigate-back');
	}

	public goForward(): void {
		this.execCommand('navigate-forward');
	}

	public reload(): void {
		this.execCommand('reload-window');
	}

	/** Asks the page's injected helper script to run a navigation command. */
	private execCommand(command: string): void {
		this.postMessage({ channel: 'execCommand', data: command });
	}

	public claim(owner: unknown, anchor: HTMLElement): void {
		this._anchor = anchor;
		this.webview.claim(owner, getWindow(anchor), undefined);
		this.webview.setAnchorElement(anchor);
	}

	public release(owner: unknown): void {
		this.webview.release(owner);
	}

	public layout(): void {
		if (this._anchor) {
			this.webview.setAnchorElement(this._anchor);
		}
	}

	public getBounds(): DOMRect {
		return this.webview.container.getBoundingClientRect();
	}

	public keepFocusOutside(): () => void {
		const container = this.webview.container;
		const focused = getActiveElement();
		return () => {
			const active = container.ownerDocument.activeElement;
			if (!active || !container.contains(active) || (focused && container.contains(focused))) {
				return;
			}
			if (isHTMLElement(focused) && focused.isConnected && focused !== focused.ownerDocument.body) {
				focused.focus();
			} else if (isHTMLElement(active)) {
				active.blur();
			}
		};
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
		this.loadedUri = true;
		this.loadUriInWebview(uri);
	}

	/**
	 * Loads a URI in the internal webview, in an iframe.
	 *
	 * This is overridden in the Electron implementation to use the webview's
	 * `setUri` method, which has native support for loading URIs.
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
					const previewIframe = document.getElementById("preview-iframe");
					const previewContentWindow = previewIframe.contentWindow;

					// Report each page load, with the page's title when it's readable
					previewIframe.addEventListener('load', () => {
						let title = '';
						try {
							title = previewIframe.contentDocument?.title ?? '';
						} catch {
							// Cross-origin page; its title can't be read
						}
						vscode.postMessage({
							__positron_preview_message: true,
							channel: 'did-load-window',
							data: { title }
						});
					});

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
	 */
	public runBridge<M extends keyof IViewerBridge>(method: M, ...args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		return this.untilDisposed(() => this.callBridge(method, args));
	}

	/**
	 * Takes a screenshot of what's on screen in the webview. The webview must
	 * be showing.
	 */
	public captureScreenshot(options?: IPreviewCaptureOptions): Promise<IViewerCapture> {
		if (options?.fullPage) {
			return Promise.reject(new Error(FULL_PAGE_UNAVAILABLE_MESSAGE));
		}
		return this.untilDisposed(() => this.capture(options?.rect));
	}

	/**
	 * Gets the address of the page showing in the webview, as the browser has
	 * it, so the page can't fake it. In web builds it's read from the app's
	 * frame; the Electron implementation asks the main process.
	 */
	public async getCurrentUrl(): Promise<string | undefined> {
		try {
			const url = this.getAppWindow().location.href;
			// The frame is on about:blank until its page loads.
			return url === 'about:blank' ? undefined : url;
		} catch {
			return undefined;
		}
	}

	public async getConsoleLogs(): Promise<string> {
		throw new Error(CONSOLE_LOGS_UNAVAILABLE_MESSAGE);
	}

	public find(): void {
		this.webview.showFind();
	}

	public async toggleDevTools(): Promise<void> {
		throw new Error(BROWSER_ONLY_MESSAGE);
	}

	public async toggleElementSelection(): Promise<void> {
		throw new Error(BROWSER_ONLY_MESSAGE);
	}

	public readonly onDidSelectElement = Event.None;

	public discardElementComment(): void {
		// A webview has no comments.
	}

	/**
	 * Runs a call into the page, but rejects as soon as the webview is
	 * disposed: a call into a page that's gone can go unanswered.
	 */
	private async untilDisposed<T>(call: () => Promise<T>): Promise<T> {
		const token = this._disposed.token;
		// Wrapped, so a call that returns nothing isn't taken for a cancelled one.
		const result = token.isCancellationRequested ? undefined : await raceCancellation(call().then(value => ({ value })), token);
		if (!result) {
			throw new Error(VIEWER_CONTENT_CHANGED_MESSAGE);
		}
		return result.value;
	}

	/**
	 * In web builds, the webview's frames are served from Positron's own
	 * origin, so the bridge runs here and reaches into the app's frame
	 * directly. Nothing is injected into the app. The Electron implementation
	 * runs the bridge in the app's frame through the main process instead.
	 */
	protected async callBridge<M extends keyof IViewerBridge>(method: M, args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
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
	 * In web builds, the screenshot is rebuilt from the app's page; the
	 * Electron implementation captures the screen instead.
	 */
	protected async capture(rect?: IViewerRect): Promise<IViewerCapture> {
		return captureDomScreenshot(this.getAppWindow(), getWindow(this.webview.container), rect);
	}

	/**
	 * Gets the window of the page showing in the webview, through its
	 * same-origin frames: the webview's iframe, then the frames inside it
	 * that `findViewerContentWindow` looks through.
	 */
	private getAppWindow(): Window & typeof globalThis {
		// The webview builds its iframe itself (webview/browser/webviewElement.ts),
		// so there's no element reference to it.
		// eslint-disable-next-line no-restricted-syntax
		const outer = this.webview.container.querySelector('iframe');
		if (!outer?.contentWindow) {
			throw new Error('The Viewer\'s content hasn\'t loaded yet.');
		}
		if (!outer.contentDocument) {
			throw new Error('Positron can\'t read the Viewer\'s content, because the Viewer is served from a different origin than Positron.');
		}
		return findViewerContentWindow(outer.contentWindow, this.loadedUri);
	}
}
