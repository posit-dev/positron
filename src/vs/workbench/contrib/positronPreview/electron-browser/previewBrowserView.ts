/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/previewBrowserView.css';
import { getZoomFactor, onDidChangeZoomLevel } from '../../../../base/browser/browser.js';
import { $, DisposableResizeObserver, getActiveElement, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import type { CodeWindow } from '../../../../base/browser/window.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { renderIcon } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { BrowserElementSelectionMode, IBrowserViewLoadError, IBrowserViewService, IElementData, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ViewerFindWidget } from './viewerFindWidget.js';
import { focusWebContentsViewContainer, WebContentsViewHost } from '../../browserView/electron-browser/webContentsViewHost.js';
import { IViewerActOutcome, IViewerBridge } from '../common/positronViewerAgent.js';
import { IPreviewCaptureOptions, IPreviewSurface, ViewerBridgeResult, ViewerInputStep } from '../browser/previewSurface.js';
import { IViewerCapture, scaleNativeScreenshot } from '../browser/viewerScreenshot.js';
import { viewerBridgeScript } from '../browser/viewerBridge.js';
import { BrowserViewBridgeSession, PageNavigatedError } from './browserViewBridgeSession.js';
import { bridgeScriptValue, ViewerBridgeScriptResult } from './previewOverlayWebview.js';

/**
 * The page's title, or an empty one when it has none, as Chromium then gives
 * the page's address as its title.
 */
function pageTitle(model: IBrowserViewModel): string {
	const title = model.title;
	return title === model.url || title === model.url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '') ? '' : title;
}

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

	private readonly _onDidSelectElement = this._register(new Emitter<IElementData>());
	readonly onDidSelectElement = this._onDidSelectElement.event;

	private readonly _root = $('.browser-root.positron-preview-browser');
	private readonly _wrapper = $('.browser-container-wrapper');
	private readonly _container = $('.browser-container');
	private readonly _placeholder = $('.browser-placeholder-contents');
	private readonly _error = $('.browser-error-container');
	private readonly _errorStore = this._register(new MutableDisposable<DisposableStore>());

	/** Holds the find widget, above the page, which shrinks to make room for it. */
	private readonly _findWrapper = $('.browser-find-widget-wrapper');
	private readonly _findWidget = this._register(new MutableDisposable<ViewerFindWidget>());

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
		@ILifecycleService lifecycleService: ILifecycleService,
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		super();
		// The main process keeps a view across a reload of the window, for
		// editors that take theirs back. Nothing takes the Viewer's back, so
		// destroy it before the window goes, and wait for that.
		const views = ProxyChannel.toService<IBrowserViewService>(mainProcessService.getChannel(ipcBrowserViewChannelName));
		this._register(lifecycleService.onWillShutdown(e => {
			const model = this._model;
			if (model) {
				e.join(views.destroyBrowserView(model.id), { id: 'positronViewer.destroyBrowserView', label: localize('positron.viewer.closingPage', "Closing the page in the Viewer") });
			}
		}));
		this._container.tabIndex = 0;
		this._error.setAttribute('role', 'alert');
		this._error.style.display = 'none';
		this._placeholder.appendChild(this._error);
		this._container.appendChild(this._placeholder);
		this._wrapper.appendChild(this._container);
		this._root.append(this._findWrapper, this._wrapper);

		this._register(onDidChangeZoomLevel(() => this.layout()));
	}

	get canGoBack(): boolean {
		return this._model?.canGoBack ?? false;
	}

	get canGoForward(): boolean {
		return this._model?.canGoForward ?? false;
	}

	get title(): string | undefined {
		return (this._model && pageTitle(this._model)) || undefined;
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
			this.showError({ url: uri.toString(true), errorDescription: error instanceof Error ? error.message : String(error) });
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
			this._onDidLoad.fire(pageTitle(model));
		}
	}

	private setModel(model: IBrowserViewModel): void {
		this._model = model;
		this._modelStore.add(model.onDidNavigate(e => this._onDidNavigate.fire(URI.parse(e.url))));
		this._modelStore.add(model.onDidChangeLoadingState(e => {
			this.showError(e.error);
			if (!e.loading && !e.error) {
				this._onDidLoad.fire(pageTitle(model));
			}
		}));
		this._modelStore.add(model.onDidSelectElement(e => this._onDidSelectElement.fire(e)));
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

	/**
	 * Shows why the page failed to load, with a button to try again, in
	 * place of the page; or clears that when there's no error.
	 */
	private showError(error: Pick<IBrowserViewLoadError, 'url' | 'errorDescription'> & { errorCode?: number } | undefined): void {
		this._errorStore.clear();
		this._error.replaceChildren();
		this._error.style.display = error ? '' : 'none';
		if (!error) {
			return;
		}

		const icon = $('.browser-error-icon');
		icon.appendChild(renderIcon(Codicon.globe));
		const title = $('.browser-error-title');
		title.textContent = localize('positron.viewer.pageFailed', "Failed to Load Page");
		const detail = $('.browser-error-detail');
		detail.textContent = error.errorCode === undefined ? error.errorDescription : `${error.errorDescription} (${error.errorCode})`;
		const url = $('.browser-error-detail');
		const urlLabel = $('strong');
		urlLabel.textContent = localize('positron.viewer.pageFailedUrl', "URL:");
		const urlValue = $('code');
		urlValue.textContent = error.url;
		url.append(urlLabel, ' ', urlValue);
		const actions = $('.positron-preview-browser-error-actions');
		const store = this._errorStore.value = new DisposableStore();
		const button = store.add(new Button(actions, defaultButtonStyles));
		button.label = localize('positron.viewer.reload', "Reload");
		store.add(button.onDidClick(() => this.reload()));

		const content = $('.browser-error-content');
		content.append(icon, title, detail, url, actions);
		this._error.appendChild(content);
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
		const host = this._instantiationService.createInstance(WebContentsViewHost, targetWindow, () => focusWebContentsViewContainer(this._container));
		this._host.value = host;
		this._placeholder.replaceChildren(host.screenshotElement, host.pauseElement, this._error);
		host.onContainerCreated(this._container);
		host.setModel(this._model);
	}

	layout(): void {
		if (!this._anchor) {
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
		// The container also holds the error shown when there's no view.
		this._container.style.left = `${x - rect.left}px`;
		this._container.style.top = `${y - rect.top}px`;
		this._container.style.width = `${width}px`;
		this._container.style.height = `${height}px`;
		const host = this._host.value;
		if (!this._model || !host) {
			return;
		}
		const visible = this._claimed
			&& width > 0
			&& height > 0
			&& rect.right > 0
			&& rect.bottom > 0
			&& rect.left < targetWindow.innerWidth
			&& rect.top < targetWindow.innerHeight;
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

	find(): void {
		const model = this._model;
		if (!model) {
			return;
		}
		if (!this._findWidget.value) {
			const widget = this._instantiationService.createInstance(ViewerFindWidget, this._findWrapper, model);
			this._findWidget.value = widget;
			// The page moves down to make room for the widget, and back when it's gone.
			const observer = this._register(new DisposableResizeObserver('ViewerFindWidget.height', () => this.layout(), getWindow(this._findWrapper)));
			this._register(observer.observe(this._findWrapper));
		}
		const widget = this._findWidget.value;
		// Find the text selected in the page, as editors do.
		model.getSelectedText().then(selected => {
			const text = selected.trim();
			widget.reveal(text && !/[\r\n]/.test(text) ? text : undefined);
			widget.layout(this._findWrapper.clientWidth);
		}, () => widget.reveal());
	}

	findNext(previous: boolean): void {
		this._findWidget.value?.find(previous);
	}

	hideFind(): void {
		this._findWidget.value?.hide();
	}

	async toggleDevTools(): Promise<void> {
		await this.loadedModel().toggleDevTools();
	}

	async toggleElementSelection(mode: 'select' | 'comment'): Promise<void> {
		const model = this.loadedModel();
		const selectionMode = mode === 'comment' ? BrowserElementSelectionMode.Comment : BrowserElementSelectionMode.Select;
		const state = model.elementSelectionState;
		const on = !(state.active && state.options.mode === selectionMode);
		await model.toggleElementSelection(on, { mode: selectionMode, continuous: mode === 'comment' });
		if (on) {
			// The user picks with the pointer or the keyboard in the page.
			await model.focus();
		}
	}

	discardElementComment(elementId: string): void {
		this._model?.setElementComments({ comments: [], pendingCommentIdsToDiscard: [elementId] })
			.catch(error => this._logService.error('[Viewer] Failed to remove a comment from the page', error));
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
