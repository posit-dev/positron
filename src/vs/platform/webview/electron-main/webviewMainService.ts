/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents, webContents, WebFrameMain } from 'electron';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { FindInFrameOptions, FoundInFrameResult, IWebviewManagerService, WebviewWebContentsId, WebviewWindowId } from 'vs/platform/webview/common/webviewManagerService';
import { WebviewProtocolProvider } from 'vs/platform/webview/electron-main/webviewProtocolProvider';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';

// --- Start Positron ---
// eslint-disable-next-line no-duplicate-imports
import { Rectangle, webFrameMain } from 'electron';
import { VSBuffer } from 'vs/base/common/buffer';

// eslint-disable-next-line no-duplicate-imports
import { WebviewFrameId } from 'vs/platform/webview/common/webviewManagerService';
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

	private readonly _onDomReady = this._register(new Emitter<WebviewFrameId>());
	public onFrameDomReady = this._onDomReady.event;

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
		return new Promise<WebviewFrameId>(resolve => {
			let frameId: WebviewFrameId | undefined;

			// Handler for navigation events; we listen for these until we find
			// the frame we're looking for, then resolve the promise
			const onNavigated = (event: any, url: string, httpResponseCode: number, httpStatusText: string, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => {
				// Ignore navigations that aren't in the main frame
				if (url !== targetUrl) {
					return;
				}

				// Extract the frame process and routing IDs
				frameId = { processId: frameProcessId, routingId: frameRoutingId };

				// Remove the listener now that we've found the frame
				window.win!.webContents.off('did-frame-navigate', onNavigated);
				resolve(frameId);
			};

			// Handler for load events; we listen for these until the frame
			// we're looking for is loaded, then emit an event
			const onLoadFinished = (event: any, isMainFrame: boolean, frameProcessId: number, frameRoutingId: number) => {
				if (frameId && frameId.processId === frameProcessId && frameId.routingId === frameRoutingId) {
					this._onDomReady.fire({ processId: frameProcessId, routingId: frameRoutingId });
					window.win!.webContents.off('did-frame-finish-load', onLoadFinished);
				}
			};

			// Listen for navigation and load events
			window.win!.webContents.on('did-frame-navigate', onNavigated);
			window.win!.webContents.on('did-frame-finish-load', onLoadFinished);
		});
	}

	public async executeJavaScript(frameId: WebviewFrameId, script: string): Promise<any> {
		const frame = webFrameMain.fromId(frameId.processId, frameId.routingId);
		if (!frame) {
			throw new Error(`No frame found with frameId: ${JSON.stringify(frameId)}`);
		}
		return frame.executeJavaScript(script);
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
