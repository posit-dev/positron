/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents, webContents, WebFrameMain } from 'electron';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { FindInFrameOptions, FoundInFrameResult, IWebviewManagerService, WebviewWebContentsId, WebviewWindowId } from '../common/webviewManagerService.js';
import { WebviewProtocolProvider } from './webviewProtocolProvider.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';

// --- Start Positron ---
// eslint-disable-next-line no-duplicate-imports
import { Rectangle, webFrameMain } from 'electron';
import { VSBuffer } from '../../../base/common/buffer.js';

// eslint-disable-next-line no-duplicate-imports
import { IDisposable } from '../../../base/common/lifecycle.js';

// eslint-disable-next-line no-duplicate-imports
import { WebviewFrameId, FrameNavigationEvent } from '../common/webviewManagerService.js';
import { DeferredPromise } from '../../../base/common/async.js';
// --- End Positron ---

export class WebviewMainService extends Disposable implements IWebviewManagerService {

	declare readonly _serviceBrand: undefined;

	private readonly _onFoundInFrame = this._register(new Emitter<FoundInFrameResult>());
	public onFoundInFrame = this._onFoundInFrame.event;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
	) {
		super();
		this._register(new WebviewProtocolProvider());
	}

	public async setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void> {
		let contents: WebContents | undefined;

		if (typeof (id as WebviewWindowId).windowId === 'number') {
			const { windowId } = (id as WebviewWindowId);
			const window = this.windowsMainService.getWindowById(windowId);
			if (!window?.win) {
				throw new Error(`Invalid windowId: ${windowId}`);
			}
			contents = window.win.webContents;
		} else {
			const { webContentsId } = (id as WebviewWebContentsId);
			contents = webContents.fromId(webContentsId);
			if (!contents) {
				throw new Error(`Invalid webContentsId: ${webContentsId}`);
			}
		}

		if (!contents.isDestroyed()) {
			contents.setIgnoreMenuShortcuts(enabled);
		}
	}

	public async findInFrame(windowId: WebviewWindowId, frameName: string, text: string, options: { findNext?: boolean; forward?: boolean }): Promise<void> {
		const initialFrame = this.getFrameByName(windowId, frameName);

		type WebFrameMainWithFindSupport = WebFrameMain & {
			findInFrame?(text: string, findOptions: FindInFrameOptions): void;
			on(event: 'found-in-frame', listener: Function): WebFrameMain;
			removeListener(event: 'found-in-frame', listener: Function): WebFrameMain;
		};
		const frame = initialFrame as unknown as WebFrameMainWithFindSupport;
		if (typeof frame.findInFrame === 'function') {
			frame.findInFrame(text, {
				findNext: options.findNext,
				forward: options.forward,
			});
			const foundInFrameHandler = (_: unknown, result: FoundInFrameResult) => {
				if (result.finalUpdate) {
					this._onFoundInFrame.fire(result);
					frame.removeListener('found-in-frame', foundInFrameHandler);
				}
			};
			frame.on('found-in-frame', foundInFrameHandler);
		}
	}

	public async stopFindInFrame(windowId: WebviewWindowId, frameName: string, options: { keepSelection?: boolean }): Promise<void> {
		const initialFrame = this.getFrameByName(windowId, frameName);

		type WebFrameMainWithFindSupport = WebFrameMain & {
			stopFindInFrame?(stopOption: 'keepSelection' | 'clearSelection'): void;
		};

		const frame = initialFrame as unknown as WebFrameMainWithFindSupport;
		if (typeof frame.stopFindInFrame === 'function') {
			frame.stopFindInFrame(options.keepSelection ? 'keepSelection' : 'clearSelection');
		}
	}

	// --- Start Positron ---

	// The onFrameNavigated event is fired when a frame in a webview navigates to
	// a new URL.
	private readonly _onFrameNavigated = this._register(new Emitter<FrameNavigationEvent>());
	public onFrameNavigation = this._onFrameNavigated.event;

	// A map of window IDs to disposables for navigation event listeners. We
	// attach a single listener to each window to capture frame navigation
	// events.
	private readonly _navigationListeners = new Map<WebviewWindowId, IDisposable>();

	// A map of pending frame navigations, from the URL of the frame to the
	// promise that will be resolved when a frame navigates to that URL.
	private readonly _pendingNavigations = new Map<string, DeferredPromise<WebviewFrameId>>();

	/**
	 * Captures the contents of the webview in the given window as a PNG image.
	 *
	 * @param windowId The ID of the window containing the webview
	 * @param area The bounding box of the area to capture. If omitted, the
	 *   entire window will be captured.
	 * @returns A promise that resolves to the contents of the webview as a PNG
	 *   image, or undefined if the webview is not found.
	 */
	public async captureContentsAsPng(windowId: WebviewWindowId, area?: Rectangle):
		Promise<VSBuffer | undefined> {
		const window = this.windowsMainService.getWindowById(windowId.windowId);
		if (!window?.win) {
			throw new Error(`Invalid windowId: ${windowId}`);
		}
		const contents = window.win.webContents;
		const image = await contents.capturePage(area);
		return VSBuffer.wrap(image.toPNG());
	}

	/**
	 * Waits for a frame to be created in a webview.
	 *
	 * @param windowId The ID of the window containing the webview
	 * @param targetUrl The URL of the frame to await creation of
	 * @returns A unique identifier for the frame
	 */
	public async awaitFrameCreation(windowId: WebviewWindowId, targetUrl: string): Promise<WebviewFrameId> {
		// Get the window containing the webview
		const window = this.windowsMainService.getWindowById(windowId.windowId);
		if (!window?.win) {
			throw new Error(`Invalid windowId: ${windowId}`);
		}

		// If we aren't already listening for navigation events on this window,
		// set up a listener to capture them
		if (!this._navigationListeners.has(windowId)) {
			// Event handler for navigation events
			const onNavigated = (_event: any,
				url: string,
				_httpResponseCode: number,
				_httpStatusText: string,
				_isMainFrame: boolean,
				frameProcessId: number,
				frameRoutingId: number) => {
				const frameId = { processId: frameProcessId, routingId: frameRoutingId };
				this.onFrameNavigated(frameId, url);
			};
			window.win!.webContents.on('did-frame-navigate', onNavigated);

			// Disposable for the listener
			const disposable = { dispose: () => window.win!.webContents.off('did-frame-navigate', onNavigated) };
			this._navigationListeners.set(windowId, disposable);

			// Register the disposable so we can clean up when the service is
			// disposed
			this._register(disposable);
		}

		// Create a new deferred promise; it will be resolved when the frame
		// navigates to the target URL.
		const deferred = new DeferredPromise<WebviewFrameId>();
		this._pendingNavigations.set(targetUrl, deferred);
		return deferred.p;
	}

	/**
	 * Executes a JavaScript code snippet in a webview frame.
	 *
	 * @param frameId The ID of the frame in which to execute the code.
	 * @param script The code to execute, as a string.
	 * @returns The result of evaluating the code.
	 */
	public async executeJavaScript(frameId: WebviewFrameId, script: string): Promise<any> {
		const frame = webFrameMain.fromId(frameId.processId, frameId.routingId);
		if (!frame) {
			throw new Error(`No frame found with frameId: ${JSON.stringify(frameId)}`);
		}
		return frame.executeJavaScript(script);
	}

	/**
	 * Handles a frame navigation event.
	 * @param frameId The ID of the frame that navigated
	 * @param url The URL to which the frame navigated
	 */
	private onFrameNavigated(frameId: WebviewFrameId, url: string): void {
		this._onFrameNavigated.fire({ frameId, url });

		// Check for any pending navigations that match this URL; if we find
		// any, complete them
		const deferred = this._pendingNavigations.get(url);
		if (deferred) {
			deferred.complete(frameId);
			this._pendingNavigations.delete(url);
		}
	}

	// --- End Positron ---

	private getFrameByName(windowId: WebviewWindowId, frameName: string): WebFrameMain {
		const window = this.windowsMainService.getWindowById(windowId.windowId);
		if (!window?.win) {
			throw new Error(`Invalid windowId: ${windowId}`);
		}
		const frame = window.win.webContents.mainFrame.framesInSubtree.find(frame => {
			return frame.name === frameName;
		});
		if (!frame) {
			throw new Error(`Unknown frame: ${frameName}`);
		}
		return frame;
	}
}
