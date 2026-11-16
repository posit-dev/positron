/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import electron, { WebContents, WebFrameMain } from 'electron';
import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { hasKey } from '../../../base/common/types.js';
import { FindInFrameOptions, FoundInFrameResult, IWebviewManagerService, WebviewWebContentsId, WebviewWindowId } from '../common/webviewManagerService.js';
import { WebviewProtocolProvider } from './webviewProtocolProvider.js';
import { IWindowsMainService } from '../../windows/electron-main/windows.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';

// --- Start Positron ---
// Use the default `electron` export for runtime values (as upstream does), so this
// module also links where `electron` is the renderer API, e.g. the unit test runner.
// eslint-disable-next-line no-duplicate-imports
import type { Rectangle } from 'electron';
// eslint-disable-next-line no-duplicate-imports
import { DisposableMap, IDisposable } from '../../../base/common/lifecycle.js';
// eslint-disable-next-line no-duplicate-imports
import { WebviewMenuShortcutsTarget, WebviewFrameId, FrameNavigationEvent, WEBVIEW_FRAME_NOT_FOUND_MESSAGE } from '../common/webviewManagerService.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Schemas } from '../../../base/common/network.js';
import { DeferredPromise } from '../../../base/common/async.js';
// --- End Positron ---

export class WebviewMainService extends Disposable implements IWebviewManagerService {

	declare readonly _serviceBrand: undefined;

	private readonly _onFoundInFrame = this._register(new Emitter<FoundInFrameResult>());
	public readonly onFoundInFrame = this._onFoundInFrame.event;

	// --- Start Positron ---
	// Key by the resolved contents, not the request object or numeric window ID:
	// both target forms share ownership, and replacement windows cannot inherit it.
	private readonly _menuShortcutOwners = this._register(new DisposableMap<WebContents, { webviewId: string; dispose(): void }>());
	// --- End Positron ---

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._register(instantiationService.createInstance(WebviewProtocolProvider));
	}

	// --- Start Positron ---
	// public async setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void> {
	public async setIgnoreMenuShortcuts(id: WebviewMenuShortcutsTarget, enabled: boolean): Promise<void> {
		// --- End Positron ---
		const contents = this.getWebContents(id);
		if (!contents) {
			throw new Error(hasKey(id, { windowId: true }) ? `Invalid windowId: ${id.windowId}` : `Invalid webContentsId: ${id.webContentsId}`);
		}
		if (!contents.isDestroyed()) {
			// --- Start Positron ---
			const owner = this._menuShortcutOwners.get(contents);
			if (enabled) {
				if (owner) {
					// Retain only the latest focus, not a set of stale focused webviews.
					owner.webviewId = id.webviewId;
				} else {
					const target = contents;
					const onDestroyed = () => this._menuShortcutOwners.deleteAndDispose(target);
					// A renderer crash or reload drops the owning webview, possibly
					// without its release, and no new webview can match the old owner.
					const onReset = () => {
						this._menuShortcutOwners.deleteAndDispose(target);
						if (!target.isDestroyed()) {
							target.setIgnoreMenuShortcuts(false);
						}
					};
					// Webviews are subframes, so only main-frame navigations reset.
					const onNavigate = (event: { isMainFrame: boolean; isSameDocument: boolean }) => {
						if (event.isMainFrame && !event.isSameDocument) {
							onReset();
						}
					};
					target.once('destroyed', onDestroyed);
					target.once('render-process-gone', onReset);
					target.on('did-start-navigation', onNavigate);
					this._menuShortcutOwners.set(target, {
						webviewId: id.webviewId,
						dispose: () => {
							target.removeListener('destroyed', onDestroyed);
							target.removeListener('render-process-gone', onReset);
							target.removeListener('did-start-navigation', onNavigate);
						},
					});
				}
			} else if (owner?.webviewId === id.webviewId) {
				this._menuShortcutOwners.deleteAndDispose(contents);
			} else {
				// A late release from a webview that no longer owns the target.
				return;
			}
			// --- End Positron ---
			contents.setIgnoreMenuShortcuts(enabled);
		}
	}

	// --- Start Positron ---
	public override dispose(): void {
		for (const contents of this._menuShortcutOwners.keys()) {
			if (!contents.isDestroyed()) {
				contents.setIgnoreMenuShortcuts(false);
			}
		}
		super.dispose();
	}
	// --- End Positron ---

	private getWebContents(id: WebviewWebContentsId | WebviewWindowId): WebContents | undefined {
		if (hasKey(id, { windowId: true })) {
			const window = this.windowsMainService.getWindowById(id.windowId)?.win;
			return window && !window.isDestroyed() ? window.webContents : undefined;
		}

		return electron.webContents.fromId(id.webContentsId);
	}

	public async findInFrame(id: WebviewWebContentsId | WebviewWindowId, frameName: string, text: string, options: { findNext?: boolean; forward?: boolean }): Promise<void> {
		const initialFrame = this.getFrameByName(id, frameName);
		if (!initialFrame) {
			return;
		}

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

	public async stopFindInFrame(id: WebviewWebContentsId | WebviewWindowId, frameName: string, options: { keepSelection?: boolean }): Promise<void> {
		const initialFrame = this.getFrameByName(id, frameName);
		if (!initialFrame) {
			return;
		}

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
	// events. Keyed by the numeric window ID; callers pass a fresh
	// WebviewWindowId object each call, so the object itself is not a stable key.
	private readonly _navigationListeners = new Map<number, IDisposable>();

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
		if (!this._navigationListeners.has(windowId.windowId)) {
			// Event handler for navigation events
			const onNavigated = (_event: any,
				url: string,
				_httpResponseCode: number,
				_httpStatusText: string,
				_isMainFrame: boolean,
				frameProcessId: number,
				frameRoutingId: number) => {
				const frameTreeNodeId = electron.webFrameMain.fromId(frameProcessId, frameRoutingId)?.frameTreeNodeId;
				const frameId = { processId: frameProcessId, routingId: frameRoutingId, frameTreeNodeId };
				this.onFrameNavigated(frameId, url);
			};
			window.win!.webContents.on('did-frame-navigate', onNavigated);

			// Show a native context menu for externally-hosted (cross-origin)
			// Viewer content, whose clipboard actions can't go through the
			// execCommand round-trip.
			const onContextMenu = (_e: Electron.Event, params: Electron.ContextMenuParams) => {
				this.showFrameContextMenu(window.win!, params);
			};
			window.win!.webContents.on('context-menu', onContextMenu);

			// Route clipboard shortcuts in externally-hosted Viewer content to the
			// native clipboard commands, which work where the in-frame/execCommand
			// paths don't.
			const onBeforeInput = (e: Electron.Event, input: Electron.Input) => {
				this.handleClipboardShortcut(window.win!, e, input);
			};
			window.win!.webContents.on('before-input-event', onBeforeInput);

			// Disposable for the listeners
			const disposable = {
				dispose: () => {
					window.win!.webContents.off('did-frame-navigate', onNavigated);
					window.win!.webContents.off('context-menu', onContextMenu);
					window.win!.webContents.off('before-input-event', onBeforeInput);
				}
			};
			this._navigationListeners.set(windowId.windowId, disposable);

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
		const frame = this.findFrame(frameId);
		if (!frame) {
			throw new Error(`${WEBVIEW_FRAME_NOT_FOUND_MESSAGE} with frameId: ${JSON.stringify(frameId)}`);
		}
		return frame.executeJavaScript(script);
	}

	/**
	 * Gets the URL of a webview frame, as the browser has it.
	 *
	 * @param frameId The ID of the frame.
	 * @returns The frame's URL, or undefined if the frame is gone.
	 */
	public async getFrameUrl(frameId: WebviewFrameId): Promise<string | undefined> {
		return this.findFrame(frameId)?.url;
	}

	/**
	 * Gets the ID of a webview's host frame, the one running the webview's own
	 * index.html. The webview's content is written into a frame inside it.
	 * Unlike `getFrameByName`, it searches every window (a Viewer can be in an
	 * auxiliary one), returns undefined rather than throwing, and skips frames
	 * inside a webview that take the same name.
	 *
	 * @param webviewId The webview's ID, which names its frame.
	 * @returns The frame's ID, or undefined if the webview has no frame.
	 */
	public async getWebviewHostFrameId(webviewId: string): Promise<WebviewFrameId | undefined> {
		const webviewPrefix = `${Schemas.vscodeWebview}://`;
		for (const contents of electron.webContents.getAllWebContents()) {
			const frame = contents.mainFrame.framesInSubtree.find(f =>
				f.name === webviewId && f.url.startsWith(webviewPrefix) && !f.parent?.url.startsWith(webviewPrefix));
			if (frame) {
				return { processId: frame.processId, routingId: frame.routingId, frameTreeNodeId: frame.frameTreeNodeId };
			}
		}
		return undefined;
	}

	/**
	 * Finds a frame by its ID. If the frame has gone to another document, the
	 * saved process and routing IDs point at a gone or detached frame, so find
	 * the frame by its place in the frame tree instead.
	 */
	private findFrame(frameId: WebviewFrameId): WebFrameMain | undefined {
		const frame = electron.webFrameMain.fromId(frameId.processId, frameId.routingId);
		if (frame && !frame.detached) {
			return frame;
		}
		if (frameId.frameTreeNodeId !== undefined) {
			for (const contents of electron.webContents.getAllWebContents()) {
				const current = contents.mainFrame.framesInSubtree.find(f => f.frameTreeNodeId === frameId.frameTreeNodeId);
				if (current) {
					return current;
				}
			}
		}
		return undefined;
	}

	/**
	 * Whether the frame is a Positron webview guest frame hosting external
	 * (cross-origin) content, e.g. a Shiny app in the Viewer. Such a frame loads
	 * an http(s) URL inside the vscode-webview:// wrapper (index-external.html),
	 * which distinguishes it from the workbench and from same-origin webviews.
	 * The wrapper may be several levels up rather than the direct parent, since
	 * Viewer content can nest iframes (e.g. Quarto dashboards, tags$iframe), so
	 * walk the parent chain looking for a vscode-webview:// ancestor.
	 *
	 * @param frame The frame to test.
	 */
	private isViewerGuestFrame(frame: Electron.WebFrameMain | null): boolean {
		if (!frame || !/^https?:\/\//.test(frame.url)) {
			return false;
		}
		for (let parent = frame.parent; parent; parent = parent.parent) {
			if (parent.url.startsWith(`${Schemas.vscodeWebview}://`)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Shows a native clipboard context menu for externally-hosted (cross-origin)
	 * webview content, e.g. a Shiny app in the Viewer. The menu uses native
	 * clipboard roles, which act on the focused frame's selection - the same
	 * mechanism as the Edit menu - so Copy/Cut/Paste work where the execCommand
	 * round-trip does not. Other content (the workbench, same-origin webviews)
	 * is left to its own menus.
	 *
	 * @param window The window in which the menu was requested.
	 * @param params The context menu parameters from the context-menu event.
	 */
	private showFrameContextMenu(window: Electron.BrowserWindow, params: Electron.ContextMenuParams): void {
		// Gate on the frame the menu was invoked in, not the focused frame; the
		// two differ when Viewer content is right-clicked without first being
		// focused.
		if (!this.isViewerGuestFrame(params.frame)) {
			return;
		}

		const menu = new electron.Menu();
		const { editFlags, isEditable } = params;
		if (isEditable && editFlags.canCut) {
			menu.append(new electron.MenuItem({ role: 'cut' }));
		}
		if (editFlags.canCopy) {
			menu.append(new electron.MenuItem({ role: 'copy' }));
		}
		if (isEditable && editFlags.canPaste) {
			menu.append(new electron.MenuItem({ role: 'paste' }));
		}
		if (menu.items.length > 0) {
			menu.append(new electron.MenuItem({ type: 'separator' }));
		}
		menu.append(new electron.MenuItem({ role: 'selectAll' }));

		menu.popup({ window, x: params.x, y: params.y });
	}

	/**
	 * Routes clipboard keyboard shortcuts in externally-hosted (cross-origin)
	 * webview content to the native clipboard commands. These act on the focused
	 * frame's selection - the same mechanism as the Edit menu - so they work for
	 * Viewer content where the in-frame and execCommand paths do not. Other
	 * content is left alone.
	 *
	 * @param window The window in which the key was pressed.
	 * @param event The before-input event, preventable to stop further handling.
	 * @param input The keyboard input.
	 */
	private handleClipboardShortcut(window: Electron.BrowserWindow, event: Electron.Event, input: Electron.Input): void {
		if (input.type !== 'keyDown' || input.alt || input.shift) {
			return;
		}
		const modifier = process.platform === 'darwin' ? input.meta : input.control;
		if (!modifier) {
			return;
		}
		if (!this.isViewerGuestFrame(window.webContents.focusedFrame)) {
			return;
		}
		switch (input.key.toLowerCase()) {
			case 'c': window.webContents.copy(); break;
			case 'x': window.webContents.cut(); break;
			case 'v': window.webContents.paste(); break;
			case 'a': window.webContents.selectAll(); break;
			default: return;
		}
		event.preventDefault();
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

	private getFrameByName(id: WebviewWebContentsId | WebviewWindowId, frameName: string): WebFrameMain | undefined {
		const contents = this.getWebContents(id);
		if (!contents || contents.isDestroyed()) {
			this.logService.trace('[WebviewMainService] Skipping find request for unavailable web contents', id);
			return undefined;
		}

		const mainFrame = contents.mainFrame;
		if (!mainFrame || mainFrame.isDestroyed()) {
			this.logService.trace('[WebviewMainService] Skipping find request for an unavailable main frame', id);
			return undefined;
		}

		// Electron can fail to convert the entire subtree while a descendant is pending deletion.
		const framesInSubtree = mainFrame.framesInSubtree;
		if (!framesInSubtree) {
			this.logService.warn('[WebviewMainService] Frame subtree unavailable for find request', id);
			return undefined;
		}

		const frame = framesInSubtree.find(frame => {
			return !frame.isDestroyed() && !frame.detached && frame.name === frameName;
		});
		if (!frame) {
			this.logService.trace('[WebviewMainService] Skipping find request for a missing frame', id, frameName);
		}
		return frame;
	}
}
