/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../base/browser/dom.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from '../../../webview/browser/webview.js';
import { IWebviewViewService, WebviewView } from '../../../webviewView/browser/webviewViewService.js';

/** The extension that fills the card. */
const ASSISTANT_EXTENSION_ID = 'posit.assistant';

/**
 * The webview view type the card asks the extension to fill. The extension
 * registers a webview view provider for it, the same way it does for its
 * sidebar view, but nothing contributes a view with this ID.
 */
export const WELCOME_ASSISTANT_CARD_VIEW_TYPE = 'posit-assistant.welcomeCard';

/**
 * Owns the Posit Assistant chat webview shown in a card on the welcome page.
 *
 * The welcome page's React tree is rebuilt whenever a walkthrough registers
 * and unmounted on every tab switch. A webview cannot be moved between
 * elements without reloading, so the editor pane owns this object instead,
 * and the React card only tells it where to draw. The webview is created on
 * first attach and kept, hidden, while no card shows it.
 */
export class WelcomeAssistantCard extends Disposable {
	private readonly _webview = this._register(new MutableDisposable<IOverlayWebview>());
	private readonly _resolveCancellation = this._register(new MutableDisposable<CancellationTokenSource>());

	private _visible = false;
	private readonly _onDidChangeVisibility = this._register(new Emitter<boolean>());
	private readonly _onDispose = this._register(new Emitter<void>());

	private _available = false;
	private readonly _onDidChangeAvailable = this._register(new Emitter<boolean>());

	/** Fires when the card should start or stop showing. */
	readonly onDidChangeAvailable: Event<boolean> = this._onDidChangeAvailable.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IWebviewViewService private readonly _webviewViewService: IWebviewViewService,
	) {
		super();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._updateAvailable();
			}
		}));
		this._register(this._extensionService.onDidChangeExtensions(() => this._updateAvailable()));
		this._updateAvailable();
	}

	/** Whether AI features are on and the Assistant extension is installed. */
	get available(): boolean {
		return this._available;
	}

	private async _updateAvailable(): Promise<void> {
		const extension = await this._extensionService.getExtension(ASSISTANT_EXTENSION_ID);
		const available = extension !== undefined && this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true;
		if (available === this._available) {
			return;
		}
		this._available = available;
		if (!available) {
			this._disposeWebview();
		}
		this._onDidChangeAvailable.fire(available);
	}

	/**
	 * Shows the webview over `anchor`, clipped to `clippingContainer`. Returns a
	 * disposable that hides it again. Only one anchor shows it at a time.
	 */
	attach(anchor: HTMLElement, clippingContainer: HTMLElement | undefined): IDisposable {
		const webview = this._webview.value ?? this._createWebview();
		const owner = {};
		webview.claim(owner, getWindow(anchor), undefined);
		webview.setAnchorElement(anchor, clippingContainer);
		this._setVisible(true);
		return toDisposable(() => {
			webview.release(owner);
			this._setVisible(false);
		});
	}

	/** Moves keyboard focus into the chat. */
	focus(): void {
		this._webview.value?.focus();
	}

	private _setVisible(visible: boolean): void {
		if (this._visible !== visible) {
			this._visible = visible;
			this._onDidChangeVisibility.fire(visible);
		}
	}

	private _createWebview(): IOverlayWebview {
		const extension = { id: new ExtensionIdentifier(ASSISTANT_EXTENSION_ID) };
		const webview = this._webviewService.createWebviewOverlay({
			providedViewType: WELCOME_ASSISTANT_CARD_VIEW_TYPE,
			title: undefined,
			options: { purpose: WebviewContentPurpose.WebviewView },
			contentOptions: {},
			extension,
		});
		this._webview.value = webview;

		const cancellation = new CancellationTokenSource();
		this._resolveCancellation.value = cancellation;

		const webviewView: WebviewView = {
			webview,
			onDidChangeVisibility: this._onDidChangeVisibility.event,
			onDispose: this._onDispose.event,
			title: undefined,
			description: undefined,
			badge: undefined,
			// The extension asked to close the view. Drop the webview; the next
			// attach creates a new one.
			dispose: () => this._disposeWebview(),
			// The card shows whenever the welcome page does, so there is
			// nothing to reveal.
			show: () => { },
		};

		void (async () => {
			await this._extensionService.activateByEvent(`onView:${WELCOME_ASSISTANT_CARD_VIEW_TYPE}`);
			await this._webviewViewService.resolve(WELCOME_ASSISTANT_CARD_VIEW_TYPE, webviewView, cancellation.token);
		})();

		return webview;
	}

	private _disposeWebview(): void {
		if (!this._webview.value) {
			return;
		}
		this._resolveCancellation.value?.cancel();
		this._resolveCancellation.clear();
		this._onDispose.fire();
		this._webview.clear();
		this._visible = false;
	}

	override dispose(): void {
		this._disposeWebview();
		super.dispose();
	}
}
