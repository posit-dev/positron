/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/previewBrowserView.css';
import { getZoomFactor, onDidChangeZoomLevel } from '../../../../base/browser/browser.js';
import { $, getActiveElement, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import type { CodeWindow } from '../../../../base/browser/window.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { focusWebContentsViewContainer, WebContentsViewHost } from '../../browserView/electron-browser/webContentsViewHost.js';
import { IViewerActOutcome, IViewerBridge } from '../common/positronViewerAgent.js';
import { IPreviewCaptureOptions, IPreviewSurface, ViewerBridgeResult, ViewerInputStep } from '../browser/previewSurface.js';
import { IViewerCapture, scaleNativeScreenshot } from '../browser/viewerScreenshot.js';
import { viewerBridgeScript } from '../browser/viewerBridge.js';
import { BrowserViewBridgeSession, PageNavigatedError } from './browserViewBridgeSession.js';
import { bridgeScriptValue, ViewerBridgeScriptResult } from './previewOverlayWebview.js';

/**
 * Shows a preview's content in the integrated browser: a native view that
 * the main process lays over the Viewer.
 */
export class PreviewBrowserView extends Disposable implements IPreviewSurface {

	public readonly kind = 'browser';

	private readonly _onDidLoad = this._register(new Emitter<string>());
	readonly onDidLoad = this._onDidLoad.event;

	private readonly _onDidNavigate = this._register(new Emitter<URI>());
	readonly onDidNavigate = this._onDidNavigate.event;

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	private readonly _root = $('.browser-root.positron-preview-browser');
	private readonly _wrapper = $('.browser-container-wrapper');
	private readonly _container = $('.browser-container');
	private readonly _placeholder = $('.browser-placeholder-contents');
	private readonly _message = $('.positron-preview-browser-message');

	/** The host for the view, created for the window the Viewer is in. */
	private readonly _host = this._register(new MutableDisposable<WebContentsViewHost>());
	private _hostWindow: CodeWindow | undefined;

	private _model: IBrowserViewModel | undefined;
	private readonly _modelStore = this._register(new DisposableStore());

	/** The connection that runs the Viewer bridge in the page, once used. */
	private readonly _bridge = this._register(new MutableDisposable<BrowserViewBridgeSession>());

	/** The address to show, until the view has been created. */
	private _uri: URI | undefined;
	private _creating = false;

	private _anchor: HTMLElement | undefined;
	private _owner: unknown;
	private _claimed = false;
	private _disposed = false;

	constructor(
		@IBrowserViewWorkbenchService private readonly _browserViewWorkbenchService: IBrowserViewWorkbenchService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._container.tabIndex = 0;
		this._message.setAttribute('role', 'status');
		this._placeholder.appendChild(this._message);
		this._container.appendChild(this._placeholder);
		this._wrapper.appendChild(this._container);
		this._root.appendChild(this._wrapper);

		this._register(onDidChangeZoomLevel(() => this.layout()));
	}

	get title(): string | undefined {
		return this._model?.title || undefined;
	}

	/**
	 * Creates the view on the address to show. The view is created once its
	 * first page has loaded; if that fails, as when an app isn't up yet, no
	 * view is left, and reloading tries again.
	 */
	private async createView(): Promise<void> {
		const uri = this._uri;
		if (!uri || this._creating) {
			return;
		}
		this._creating = true;
		let model: IBrowserViewModel;
		try {
			model = await this._browserViewWorkbenchService.createExternalBrowserView(uri.toString(true));
		} catch (error) {
			this._creating = false;
			this.showError(error instanceof Error ? error.message : String(error));
			if (this._uri !== uri) {
				return this.createView();
			}
			return;
		}
		this._creating = false;
		if (this._disposed) {
			model.dispose();
			return;
		}
		const latest = this._uri;
		this._uri = undefined;
		this.setModel(model);
		if (latest && latest !== uri) {
			this.loadUri(latest);
		} else {
			// The first page loaded before the view was handed over.
			this.showError(undefined);
			this._onDidNavigate.fire(URI.parse(model.url));
			this._onDidLoad.fire(model.title);
		}
	}

	private setModel(model: IBrowserViewModel): void {
		this._model = model;
		this._modelStore.add(model.onDidNavigate(e => this._onDidNavigate.fire(URI.parse(e.url))));
		this._modelStore.add(model.onDidChangeLoadingState(e => {
			this.showError(e.error?.errorDescription);
			if (!e.loading && !e.error) {
				this._onDidLoad.fire(model.title);
			}
		}));
		this._modelStore.add(model.onDidChangeFocus(e => {
			if (e.focused) {
				focusWebContentsViewContainer(this._container);
			}
		}));
		// The page closed itself, or its renderer went away.
		this._modelStore.add(model.onDidClose(() => this.dispose()));
		this._modelStore.add(model.onWillDispose(() => {
			this._model = undefined;
			this.dispose();
		}));

		this._host.value?.setModel(model);
		this.layout();
	}

	private showError(description: string | undefined): void {
		this._message.textContent = description ?
			localize('positron.viewer.pageFailed', "The page could not be loaded: {0}", description) :
			'';
	}

	loadUri(uri: URI): void {
		if (!this._model) {
			this._uri = uri;
			this.createView();
			return;
		}
		// Load errors are reported through the model's loading state.
		this._model.loadURL(uri.toString(true)).catch(() => { });
	}

	goBack(): void {
		this._model?.goBack().catch(error => this._logService.error('[Viewer] Failed to go back', error));
	}

	goForward(): void {
		this._model?.goForward().catch(error => this._logService.error('[Viewer] Failed to go forward', error));
	}

	reload(): void {
		if (this._model) {
			this._model.reload().catch(error => this._logService.error('[Viewer] Failed to reload', error));
		} else {
			this.createView();
		}
	}

	setTitle(): void {
		// The page owns its title.
	}

	claim(owner: unknown, anchor: HTMLElement): void {
		this._owner = owner;
		this._claimed = true;
		if (this._anchor !== anchor) {
			this._anchor = anchor;
			anchor.appendChild(this._root);
		}
		this.ensureHost(getWindow(anchor));
		this.layout();
	}

	release(owner: unknown): void {
		if (owner === this._owner) {
			this._claimed = false;
			this._host.value?.setVisible(false);
		}
	}

	/**
	 * Creates the host for the window the Viewer is in: the host watches that
	 * window for overlays drawn over the view.
	 */
	private ensureHost(targetWindow: CodeWindow): void {
		if (this._hostWindow === targetWindow) {
			return;
		}
		this._hostWindow = targetWindow;
		// The old host's elements go with it.
		this._placeholder.replaceChildren(this._message);
		const host = this._instantiationService.createInstance(WebContentsViewHost, targetWindow, () => focusWebContentsViewContainer(this._container));
		this._host.value = host;
		this._placeholder.append(host.screenshotElement, host.pauseElement);
		host.onContainerCreated(this._container);
		host.setModel(this._model);
	}

	layout(): void {
		const host = this._host.value;
		if (!this._model || !this._anchor || !host) {
			return;
		}
		const targetWindow = getWindow(this._anchor);
		const rect = this._wrapper.getBoundingClientRect();
		const zoomFactor = getZoomFactor(targetWindow);
		const snap = (value: number) => Math.floor(value * zoomFactor) / zoomFactor;
		const x = snap(rect.left);
		const y = snap(rect.top);
		const width = snap(rect.width);
		const height = snap(rect.height);
		const visible = this._claimed
			&& width > 0
			&& height > 0
			&& rect.right > 0
			&& rect.bottom > 0
			&& rect.left < targetWindow.innerWidth
			&& rect.top < targetWindow.innerHeight;
		this._container.style.left = `${x - rect.left}px`;
		this._container.style.top = `${y - rect.top}px`;
		this._container.style.width = `${width}px`;
		this._container.style.height = `${height}px`;
		host.setVisible(visible);
		this._model.layout({ x, y, width, height, windowId: targetWindow.vscodeWindowId, zoomFactor, cornerRadius: 0 })
			.catch(error => this._logService.error('[Viewer] Failed to lay out the browser view', error));
		host.layout();
	}

	getBounds(): DOMRect {
		return this._wrapper.getBoundingClientRect();
	}

	keepFocusOutside(): () => void {
		const focused = getActiveElement();
		const wasFocused = this._model?.focused ?? false;
		return () => {
			if (wasFocused || !this._model?.focused) {
				return;
			}
			if (isHTMLElement(focused) && focused.isConnected && focused !== focused.ownerDocument.body && !this._container.contains(focused)) {
				focused.focus();
			} else {
				this._container.blur();
			}
		};
	}

	/**
	 * Runs the bridge in the page through CDP, in the page's own JavaScript
	 * world, which the page can tamper with.
	 */
	async runBridge<M extends keyof IViewerBridge>(method: M, ...args: Parameters<IViewerBridge[M]>): Promise<ViewerBridgeResult<M>> {
		const model = this.loadedModel();
		this._bridge.value ??= this._instantiationService.createInstance(BrowserViewBridgeSession, model.id);
		try {
			return bridgeScriptValue(await this._bridge.value.evaluate(viewerBridgeScript(method, args)) as ViewerBridgeScriptResult<M>);
		} catch (error) {
			// The bridge reports an action that leads to another page, but the
			// page can be gone before its answer is sent.
			if (method === 'act' && error instanceof PageNavigatedError) {
				const outcome: IViewerActOutcome = { message: 'The page went to another address during the action.', navigated: true, timedOut: false };
				return outcome as ViewerBridgeResult<M>;
			}
			throw error;
		}
	}

	async dispatchInput(steps: readonly ViewerInputStep[]): Promise<void> {
		const model = this.loadedModel();
		this._bridge.value ??= this._instantiationService.createInstance(BrowserViewBridgeSession, model.id);
		await this._bridge.value.dispatchInput(steps);
	}

	async getConsoleLogs(): Promise<string> {
		return this.loadedModel().getConsoleLogs();
	}

	private loadedModel(): IBrowserViewModel {
		if (!this._model) {
			throw new Error('The Viewer\'s content hasn\'t loaded yet.');
		}
		return this._model;
	}

	async captureScreenshot(options?: IPreviewCaptureOptions): Promise<IViewerCapture> {
		const png = await this.loadedModel().captureScreenshot({ format: 'png', fullPage: options?.fullPage });
		return scaleNativeScreenshot(png, getWindow(this._anchor ?? this._container), options?.fullPage ? undefined : options?.rect);
	}

	async getCurrentUrl(): Promise<string | undefined> {
		return this._model?.url || undefined;
	}

	override dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._root.remove();
		this._host.clear();
		this._modelStore.clear();
		this._model?.dispose();
		this._onDidDispose.fire();
		super.dispose();
	}
}
