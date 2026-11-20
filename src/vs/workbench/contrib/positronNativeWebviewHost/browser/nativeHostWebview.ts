/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from '../../../../base/browser/mouseEvent.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { FileAccess, Schemas } from '../../../../base/common/network.js';
import { IObservable, observableValue } from '../../../../base/common/observable.js';
import { isEqualOrParent } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { WebviewFrameId } from '../../../../platform/webview/common/webviewManagerService.js';
import { IOverlayWebview, WebviewContentOptions, WebviewExtensionDescription, WebviewMessageReceivedEvent, WebviewOptions } from '../../webview/browser/webview.js';
import { decodeAuthority, webviewRootResourceAuthority } from '../../webview/common/webview.js';
import { WebviewThemeDataProvider } from '../../webview/browser/themeing.js';

/**
 * The version of the host contract this file implements. A module can check
 * it and fall back when it needs a newer contract.
 */
const NATIVE_HOST_CONTRACT_VERSION = 1;

/**
 * The object Positron passes to a native module's `mount`. It replaces what
 * a webview iframe gives its content: a message channel, saved state, theme
 * information, and a way to turn resource URLs into URLs the page can load.
 */
export interface INativeWebviewHost {
	readonly contractVersion: number;
	readonly shadowRoot: ShadowRoot;
	/** The `<meta name=... content=...>` tags from the HTML the extension set. */
	readonly config: Readonly<Record<string, string>>;
	postMessage(message: unknown): void;
	onMessage(listener: (message: unknown) => void): IDisposable;
	getState(): unknown;
	setState(state: unknown): void;
	/** Turns a webview resource URL (from `asWebviewUri`) into one the page can load. */
	asResourceUri(webviewUri: string): string;
	readonly theme: {
		readonly kind: string;
		onDidChange(listener: (kind: string) => void): IDisposable;
	};
	readonly visible: boolean;
	onDidChangeVisibility(listener: (visible: boolean) => void): IDisposable;
}

/**
 * Where a view's module lives. Known once the extension's manifest is read.
 */
export interface INativeModuleLocation {
	readonly extensionLocation: URI;
	readonly moduleUri: URI;
}

/**
 * What a native module must export.
 */
export interface INativeWebviewModule {
	/**
	 * Renders into `container`. A module can be mounted into several
	 * containers at once, one per view.
	 */
	mount(container: HTMLElement, host: INativeWebviewHost): void | Promise<void>;
	/** Removes what `mount` rendered into `container`. */
	unmount(container: HTMLElement): void;
}

/**
 * A stand-in for a webview that renders an extension's ES module directly in
 * the workbench page, inside a shadow root, instead of in an iframe. It
 * implements the overlay webview interface so the extension host's webview
 * messaging works unchanged.
 */
export class NativeHostWebview extends Disposable implements IOverlayWebview {

	readonly container: HTMLElement;
	private readonly _shadowRoot: ShadowRoot;
	private _mountElement: HTMLElement | undefined;

	readonly providedViewType?: string;
	origin: string;
	options: WebviewOptions;
	contentOptions: WebviewContentOptions;
	localResourcesRoot: readonly URI[] = [];
	extension: WebviewExtensionDescription | undefined;
	initialScrollProgress = 0;

	private _state: string | undefined;
	private _config: Record<string, string> = {};
	private _module: INativeWebviewModule | undefined;
	private _moduleLoad: Promise<void> | undefined;
	private _mounted = false;
	private _claimant: unknown;
	private _visible = false;

	private readonly _mountDisposables = this._register(new DisposableStore());
	private readonly _messageListeners = new Set<(message: unknown) => void>();
	private readonly _pendingMessages: unknown[] = [];
	private readonly _visibilityListeners = new Set<(visible: boolean) => void>();

	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;
	private readonly _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur = this._onDidBlur.event;
	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;
	private readonly _onMessage = this._register(new Emitter<WebviewMessageReceivedEvent>());
	readonly onMessage = this._onMessage.event;
	private readonly _onDidUpdateState = this._register(new Emitter<string | undefined>());
	readonly onDidUpdateState = this._onDidUpdateState.event;

	readonly onDidClickLink = Event.None as Event<string>;
	readonly onDidScroll = Event.None as Event<{ readonly scrollYPercentage: number }>;
	readonly onDidWheel = Event.None as Event<IMouseWheelEvent>;
	readonly onFatalError: Event<{ readonly message: string }>;
	private readonly _onFatalError = this._register(new Emitter<{ readonly message: string }>());
	readonly onMissingCsp = Event.None as Event<ExtensionIdentifier>;
	readonly onDidNavigate = Event.None as Event<URI>;
	readonly onDidLoad = Event.None as Event<string>;
	readonly intrinsicContentSize: IObservable<{ readonly width: number; readonly height: number } | undefined> = observableValue(this, undefined);

	constructor(
		init: {
			readonly providedViewType: string;
			readonly options: WebviewOptions;
			readonly extension: WebviewExtensionDescription;
			/**
			 * Resolves once the extension's manifest is read. Editor tabs restored
			 * at startup are created before that happens.
			 */
			readonly location: Promise<INativeModuleLocation | undefined>;
		},
		@IThemeService private readonly _themeService: IThemeService,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this.providedViewType = init.providedViewType;
		this.options = init.options;
		this.contentOptions = {};
		this.extension = init.extension;
		this.origin = generateUuid();
		this._location = init.location;
		this.onFatalError = this._onFatalError.event;

		this.container = document.createElement('div');
		this.container.className = 'positron-native-webview-host';
		this.container.style.width = '100%';
		this.container.style.height = '100%';
		this.container.style.display = 'none';
		// The workbench turns off text selection, and the setting is inherited.
		// Content in an iframe starts with it on, so turn it back on here.
		this.container.style.userSelect = 'text';
		this.container.style.webkitUserSelect = 'text';
		this._shadowRoot = this.container.attachShadow({ mode: 'open' });

		// Give the content the same theme variables a webview iframe gets,
		// including the font variables the workbench page does not define.
		const themeData = this._register(instantiationService.createInstance(WebviewThemeDataProvider));
		this._register(Event.runAndSubscribe(themeData.onThemeDataChanged, () => {
			const { styles, activeTheme } = themeData.getWebviewThemeData();
			for (const [name, value] of Object.entries(styles)) {
				this.container.style.setProperty(`--${name}`, String(value));
			}
			this.container.dataset.vscodeThemeKind = activeTheme;
		}));

		this._register(toDisposable(() => {
			this._unmount();
			this.container.remove();
			this._onDidDispose.fire();
		}));

		this.container.addEventListener('focusin', () => this._onDidFocus.fire());
		this.container.addEventListener('focusout', e => {
			if (!(e.relatedTarget instanceof Node) || !this.container.contains(e.relatedTarget)) {
				this._onDidBlur.fire();
			}
		});
	}

	private readonly _location: Promise<INativeModuleLocation | undefined>;
	private _extensionLocation: URI | undefined;
	private _html: string | undefined;

	//#region Overlay positioning: the host element lives inside the pane, so there is nothing to position.

	claim(claimant: unknown, _targetWindow: CodeWindow, _scopedContextKeyService: IContextKeyService | undefined): void {
		this._claimant = claimant;
		this._setVisible(true);
		this._ensureModuleLoaded();
	}

	release(claimant: unknown): void {
		if (this._claimant !== claimant) {
			return;
		}
		this._claimant = undefined;
		// Keep the UI mounted while hidden, like retainContextWhenHidden.
		this._setVisible(false);
	}

	setAnchorElement(element: HTMLElement, _clippingContainer?: HTMLElement): void {
		if (this.container.parentElement !== element) {
			element.appendChild(this.container);
		}
	}

	private _setVisible(visible: boolean): void {
		if (this._visible === visible) {
			return;
		}
		this._visible = visible;
		this.container.style.display = visible ? 'block' : 'none';
		for (const listener of this._visibilityListeners) {
			listener(visible);
		}
	}

	//#endregion

	//#region Content

	setHtml(html: string): void {
		this._html = html;
		// The extension sets new HTML to reset its UI. Mount it again.
		if (this._mounted) {
			this._unmount();
		}
		this._tryMount();
	}

	setTitle(_title: string): void { }

	setUri(_uri: URI): void {
		throw new Error('A native webview cannot load a URI.');
	}

	get state(): string | undefined {
		return this._state;
	}

	set state(value: string | undefined) {
		this._state = value;
	}

	private _readMetaTags(html: string): Record<string, string> {
		// DOMParser is a Trusted Types sink, so read the tags with a pattern instead.
		const config: Record<string, string> = {};
		for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
			const attributes = match[1];
			const name = /\bname\s*=\s*"(?<value>[^"]*)"/i.exec(attributes)?.groups?.value;
			const content = /\bcontent\s*=\s*"(?<value>[^"]*)"/i.exec(attributes)?.groups?.value;
			if (name !== undefined && content !== undefined) {
				config[name] = this._rewriteResourceUrl(decodeHtmlEntities(content));
			}
		}
		return config;
	}

	/**
	 * Webview resource URLs only resolve inside a webview iframe. Turn them
	 * back into a file URI and then into a URL the workbench page can load.
	 * Only files inside the extension's folder are allowed.
	 */
	private _rewriteResourceUrl(value: string): string {
		let parsed: URI;
		try {
			parsed = URI.parse(value);
		} catch {
			return value;
		}
		if (parsed.scheme !== Schemas.https || !parsed.authority.endsWith(`.${webviewRootResourceAuthority}`)) {
			return value;
		}
		const encoded = parsed.authority.slice(0, -(webviewRootResourceAuthority.length + 1));
		const separator = encoded.indexOf('+');
		const scheme = separator === -1 ? encoded : encoded.slice(0, separator);
		const authority = separator === -1 ? '' : decodeAuthority(encoded.slice(separator + 1));
		const resource = URI.from({ scheme, authority, path: parsed.path, query: parsed.query, fragment: parsed.fragment });
		if (!this._extensionLocation || !isEqualOrParent(resource, this._extensionLocation)) {
			this._logService.warn(`[NativeHostWebview] Blocked a resource outside the extension folder: ${resource.toString()}`);
			return value;
		}
		return FileAccess.uriToBrowserUri(resource).toString(true);
	}

	//#endregion

	//#region Module lifecycle

	private _ensureModuleLoaded(): void {
		if (this._moduleLoad) {
			return;
		}
		this._moduleLoad = (async () => {
			const location = await this._location;
			if (!location) {
				this._logService.error(`[NativeHostWebview] ${this.providedViewType} has no native module.`);
				this._onFatalError.fire({ message: 'No native module for this view.' });
				return;
			}
			this._extensionLocation = location.extensionLocation;
			const url = FileAccess.uriToBrowserUri(location.moduleUri).toString(true);
			const started = performance.now();
			try {
				const module = await import(url) as Partial<INativeWebviewModule>;
				if (typeof module.mount !== 'function' || typeof module.unmount !== 'function') {
					throw new Error('The module must export mount() and unmount().');
				}
				this._module = module as INativeWebviewModule;
				this._logService.info(`[NativeHostWebview] Loaded ${url} in ${Math.round(performance.now() - started)} ms`);
				this._tryMount();
			} catch (error) {
				this._logService.error(`[NativeHostWebview] Failed to load ${url}`, error);
				this._onFatalError.fire({ message: String(error) });
			}
		})();
	}

	private _tryMount(): void {
		if (this._mounted || !this._module || this._html === undefined || this._store.isDisposed) {
			return;
		}
		this._mounted = true;
		// Read the startup settings now: rewriting resource URLs needs the
		// extension's folder, which is known once the module has loaded.
		this._config = this._readMetaTags(this._html);

		this._mountElement = document.createElement('div');
		this._mountElement.style.width = '100%';
		this._mountElement.style.height = '100%';
		// Focusable, so a click on text inside the content focuses this element
		// instead of the pane around it. The pane forwards its own focus to
		// focus(), which would move focus into an input and clear a selection.
		this._mountElement.tabIndex = -1;
		this._mountElement.style.outline = 'none';
		this._shadowRoot.appendChild(this._mountElement);

		const started = performance.now();
		try {
			const result = this._module.mount(this._mountElement, this._createHost());
			Promise.resolve(result).then(
				() => this._logService.info(`[NativeHostWebview] Mounted in ${Math.round(performance.now() - started)} ms`),
				error => this._logService.error('[NativeHostWebview] mount() failed', error));
		} catch (error) {
			this._logService.error('[NativeHostWebview] mount() failed', error);
		}
	}

	private _unmount(): void {
		if (!this._mounted) {
			return;
		}
		this._mounted = false;
		try {
			if (this._mountElement) {
				this._module?.unmount(this._mountElement);
			}
		} catch (error) {
			this._logService.error('[NativeHostWebview] unmount() failed', error);
		}
		this._mountDisposables.clear();
		this._messageListeners.clear();
		this._visibilityListeners.clear();
		this._mountElement?.remove();
		this._mountElement = undefined;
	}

	private _createHost(): INativeWebviewHost {
		const self = this;
		const disposables = this._mountDisposables;
		return {
			contractVersion: NATIVE_HOST_CONTRACT_VERSION,
			shadowRoot: this._shadowRoot,
			config: { ...this._config },
			postMessage: message => {
				this._onMessage.fire({ message });
			},
			onMessage: listener => {
				this._messageListeners.add(listener);
				// Deliver messages that arrived before the module listened.
				const pending = this._pendingMessages.splice(0);
				for (const message of pending) {
					listener(message);
				}
				return disposables.add(toDisposable(() => this._messageListeners.delete(listener)));
			},
			getState: () => {
				if (this._state === undefined) {
					return undefined;
				}
				try {
					return JSON.parse(this._state);
				} catch {
					return undefined;
				}
			},
			setState: state => {
				this._state = JSON.stringify(state);
				this._onDidUpdateState.fire(this._state);
			},
			asResourceUri: webviewUri => this._rewriteResourceUrl(webviewUri),
			theme: {
				get kind() { return self._themeService.getColorTheme().type; },
				onDidChange: listener => disposables.add(this._themeService.onDidColorThemeChange(theme => listener(theme.type))),
			},
			get visible() { return self._visible; },
			onDidChangeVisibility: listener => {
				this._visibilityListeners.add(listener);
				return disposables.add(toDisposable(() => this._visibilityListeners.delete(listener)));
			},
		};
	}

	//#endregion

	//#region Messaging

	async postMessage(message: unknown, _transfer?: readonly ArrayBuffer[]): Promise<boolean> {
		if (this._messageListeners.size === 0) {
			this._pendingMessages.push(message);
			return true;
		}
		for (const listener of this._messageListeners) {
			listener(message);
		}
		return true;
	}

	//#endregion

	//#region Focus

	get isFocused(): boolean {
		const active = this.container.ownerDocument.activeElement;
		return active === this.container || (active instanceof Node && this.container.contains(active));
	}

	focus(): void {
		if (this.isFocused) {
			return;
		}
		// Moving focus to an input would clear text the user selected in the
		// content, for example to copy it. Focus the container instead.
		const selection = (this._shadowRoot as ShadowRoot & { getSelection?(): Selection | null }).getSelection?.();
		if (selection && !selection.isCollapsed) {
			this._mountElement?.focus({ preventScroll: true });
			return;
		}
		const target = this._shadowRoot.querySelector<HTMLElement>('[autofocus], textarea, [contenteditable="true"], input, button, [tabindex]:not([tabindex="-1"])');
		(target ?? this._mountElement)?.focus();
	}

	//#endregion

	//#region Members that only apply to iframes

	reload(): void {
		if (this._mounted) {
			this._unmount();
			this._tryMount();
		}
	}

	showFind(): void { }
	hideFind(): void { }
	runFindAction(): void { }
	async captureContentsAsPng(): Promise<VSBuffer | undefined> { return undefined; }
	async executeJavaScript(_frameId: WebviewFrameId, _code: string): Promise<unknown> { return undefined; }
	getContentFrameId(): WebviewFrameId | undefined { return undefined; }
	async getFrameUrl(): Promise<string | undefined> { return undefined; }
	async getHostFrameId(): Promise<WebviewFrameId | undefined> { return undefined; }
	// The Edit menu calls these on the active editor tab's webview. The content
	// lives in this page, so run the page's own editing commands.
	selectAll(): void { this._execCommand('selectAll'); }
	copy(): void { this._execCommand('copy'); }
	paste(): void { this._execCommand('paste'); }
	cut(): void { this._execCommand('cut'); }
	undo(): void { this._execCommand('undo'); }
	redo(): void { this._execCommand('redo'); }

	private _execCommand(command: string): void {
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		this.container.ownerDocument.execCommand(command);
	}
	windowDidDragStart(): void { }
	windowDidDragEnd(): void { }
	setContextKeyService(_scopedContextKeyService: IContextKeyService): void { }

	//#endregion
}

function decodeHtmlEntities(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, '\'')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}
