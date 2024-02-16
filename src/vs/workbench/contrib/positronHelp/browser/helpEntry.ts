/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { isMacintosh } from 'vs/base/common/platform';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { PositronHelpFocused } from 'vs/workbench/common/contextkeys';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { isLocalhost } from 'vs/workbench/contrib/positronHelp/browser/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { KeyEvent } from 'vs/workbench/contrib/webview/browser/webviewMessages';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { WebviewFindDelegate } from 'vs/workbench/contrib/webview/browser/webviewFindWidget';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { POSITRON_HELP_COPY } from 'vs/workbench/contrib/positronHelp/browser/positronHelpIdentifiers';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Constants.
 */
const TITLE_TIMEOUT = 1000;
const DISPOSE_TIMEOUT = 15 * 1000;

/**
 * Generates a nonce.
 * @returns The nonce.
 */
function generateNonce() {
	// Generate the nonce. crypto.randomInt() would be nicer, but it's not available.
	let nonce = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 64; i++) {
		nonce += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	// Return the nonce.
	return nonce;
}

/**
 * Shortens a URL.
 * @param url The URL.
 * @returns The shortened URL.
 */
const shortenUrl = (url: string) => url.replace(new URL(url).origin, '');

/**
 * KeyboardMessage type.
 */
type KeyboardMessage = {
	readonly key: string;
	readonly keyCode: number;
	readonly code: string;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly repeat: boolean;
};

/**
 * PositronHelpMessageInteractive type.
 */
type PositronHelpMessageInteractive = {
	readonly id: 'positron-help-interactive';
};

/**
 * PositronHelpMessageComplete type.
 */
type PositronHelpMessageComplete = {
	readonly id: 'positron-help-complete';
	readonly url: string;
	readonly title?: string;
};

/**
 * PositronHelpMessageNavigate type.
 */
type PositronHelpMessageNavigate = {
	readonly id: 'positron-help-navigate';
	readonly url: string;
};

/**
 * PositronHelpMessageNavigateBackward type.
 */
type PositronHelpMessageNavigateBackward = {
	readonly id: 'positron-help-navigate-backward';
};

/**
 * PositronHelpMessageNavigateForward type.
 */
type PositronHelpMessageNavigateForward = {
	readonly id: 'positron-help-navigate-forward';
};

/**
 * PositronHelpMessageScroll type.
 */
type PositronHelpMessageScroll = {
	readonly id: 'positron-help-scroll';
	readonly scrollX: number;
	readonly scrollY: number;
};

/**
 * PositronHelpMessageFindResult type.
 */
type PositronHelpMessageFindResult = {
	readonly id: 'positron-help-find-result';
	readonly findResult: boolean;
};

/**
 * PositronHelpMessageContextMenu type.
 */
type PositronHelpMessageContextMenu = {
	readonly id: 'positron-help-context-menu';
	readonly screenX: number;
	readonly screenY: number;
	readonly selection: string;
};

/**
 * PositronHelpMessageKeyDown type.
 */
type PositronHelpMessageKeydown = {
	readonly id: 'positron-help-keydown';
} & KeyboardMessage;

/**
 * PositronHelpMessageKeyup type.
 */
type PositronHelpMessageKeyup = {
	readonly id: 'positron-help-keyup';
} & KeyboardMessage;

/**
 * PositronHelpMessageSelection type.
 */
type PositronHelpMessageCopySelection = {
	readonly id: 'positron-help-copy-selection';
	selection: string;
};

/**
 * PositronHelpMessage type.
 */
type PositronHelpMessage =
	| PositronHelpMessageInteractive
	| PositronHelpMessageComplete
	| PositronHelpMessageNavigate
	| PositronHelpMessageNavigateBackward
	| PositronHelpMessageNavigateForward
	| PositronHelpMessageScroll
	| PositronHelpMessageFindResult
	| PositronHelpMessageContextMenu
	| PositronHelpMessageKeydown
	| PositronHelpMessageKeyup
	| PositronHelpMessageCopySelection;

/**
 * IHelpEntry interface.
 */
export interface IHelpEntry {
	/**
	 * Gets the source URL.
	 */
	readonly sourceUrl: string;

	/**
	 * Gets the title.
	 */
	readonly title: string | undefined;

	/**
	 * The onDidChangeTitle event.
	 */
	readonly onDidChangeTitle: Event<String>;

	/**
	 * The onDidNavigate event.
	 */
	readonly onDidNavigate: Event<String>;

	/**
	 * The onDidNavigateBackward event.
	 */
	readonly onDidNavigateBackward: Event<void>;

	/**
	 * The onDidNavigateForward event.
	 */
	readonly onDidNavigateForward: Event<void>;

	/**
	 * Shows the help overlay webiew.
	 * @param element The element over which to show the help overlay webiew.
	 */
	showHelpOverlayWebview(element: HTMLElement): void;

	/**
	 * Hides the help overlay webiew.
	 * @param dispose A value which indicates whether to dispose of the help overlay webiew.
	 */
	hideHelpOverlayWebview(dispose: boolean): void;

	/**
	 * Shows find.
	 */
	showFind(): void;

	/**
	 * Hides find.
	 */
	hideFind(): void;
}

/**
 * HelpEntry class.
 */
export class HelpEntry extends Disposable implements IHelpEntry, WebviewFindDelegate {
	//#region Private Properties

	/**
	 * Gets or sets the title.
	 */
	private _title?: string;

	/**
	 * The X scroll position.
	 */
	private _scrollX = 0;

	/**
	 * The Y scroll position.
	 */
	private _scrollY = 0;

	/**
	 * The element over which the help overlay webview is displayed.
	 */
	private _element?: HTMLElement;

	/**
	 * Gets or sets the help overlay webview.
	 */
	private _helpOverlayWebview?: IOverlayWebview;

	/**
	 * Gets or sets the set title timeout. This timeout is used to default the title in case the
	 * MessageHelpLoaded message is not received.
	 */
	private _setTitleTimeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the dispose timeout. This timeout is used to schedule the disposal of the help
	 * overlay webview.
	 */
	private _disposeTimeout?: NodeJS.Timeout;

	/**
	 * The onDidChangeTitle event emitter.
	 */
	private readonly _onDidChangeTitleEmitter = this._register(new Emitter<string>);

	/**
	 * The onDidNavigate event emitter.
	 */
	private readonly _onDidNavigateEmitter = this._register(new Emitter<string>);

	/**
	 * The onDidNavigateBackward event emitter.
	 */
	private readonly _onDidNavigateBackwardEmitter = this._register(new Emitter<void>);

	/**
	 * The onDidNavigateForward event emitter.
	 */
	private readonly _onDidNavigateForwardEmitter = this._register(new Emitter<void>);

	/**
	 * The hasFindResult event emitter.
	 */
	private readonly _hasFindResultEmitter = this._register(new Emitter<boolean>);

	/**
	 * The onDidStopFind event emitter.
	 */
	private readonly _onDidStopFindEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param helpHTML The help HTML.
	 * @param languageId The language ID.
	 * @param sessionId The runtime session ID.
	 * @param languageName The language name.
	 * @param sourceUrl The source URL.
	 * @param targetUrl The target URL.
	 * @param _clipboardService The IClipboardService.
	 * @param _contextKeyService The IContextKeyService.
	 * @param _contextMenuService The IContextMenuService.
	 * @param _notificationService The INotificationService.
	 * @param _openerService The IOpenerService.
	 * @param _themeService The IThemeService.
	 * @param _webviewService the IWebviewService.
	 */
	constructor(
		public readonly helpHTML: string,
		public readonly languageId: string,
		public readonly sessionId: string,
		public readonly languageName: string,
		public readonly sourceUrl: string,
		public readonly targetUrl: string,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IThemeService private readonly _themeService: IThemeService,
		@IWebviewService private readonly _webviewService: IWebviewService
	) {
		// Call the base class's constructor.
		super();

		// Register onDidColorThemeChange handler.
		this._register(this._themeService.onDidColorThemeChange(_colorTheme => {
			// Reload the help overlay webview.
			this._helpOverlayWebview?.reload();
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Clear the set title timeout.
		if (this._setTitleTimeout) {
			clearTimeout(this._setTitleTimeout);
			this._setTitleTimeout = undefined;
		}

		// Clear the dispose timeout.
		if (this._disposeTimeout) {
			clearTimeout(this._disposeTimeout);
			this._disposeTimeout = undefined;
		}

		// Dispose of the help overlay webiew.
		if (this._helpOverlayWebview) {
			this._helpOverlayWebview.dispose();
			this._helpOverlayWebview = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region IHelpEntry Implementation

	/**
	 * Gets the title.
	 */
	get title() {
		return this._title;
	}

	/**
	 * The onDidChangeTitle event.
	 */
	readonly onDidChangeTitle = this._onDidChangeTitleEmitter.event;

	/**
	 * The onDidNavigate event.
	 */
	readonly onDidNavigate = this._onDidNavigateEmitter.event;

	/**
	 * The onDidNavigateBackward event.
	 */
	readonly onDidNavigateBackward = this._onDidNavigateBackwardEmitter.event;

	/**
	 * The onDidNavigateForward event.
	 */
	readonly onDidNavigateForward = this._onDidNavigateForwardEmitter.event;

	/**
	 * Shows the help overlay webiew.
	 * @param element The element over which to show the help overlay webiew.
	 */
	public showHelpOverlayWebview(element: HTMLElement) {
		// If the dispose timeout is running, clear it.
		if (this._disposeTimeout) {
			clearTimeout(this._disposeTimeout);
			this._disposeTimeout = undefined;
		}

		// If the help overlay webview has not been created, create it.
		if (!this._helpOverlayWebview) {
			// Create the help overlay webview.
			this._helpOverlayWebview = this._webviewService.createWebviewOverlay({
				title: 'Positron Help',
				extension: {
					id: new ExtensionIdentifier('positron-help'),
				},
				options: {
					purpose: WebviewContentPurpose.WebviewView,
					enableFindWidget: true,
					webviewFindDelegate: this,
					// It is absolutely critical that disableServiceWorker is set to true. If it is
					// not, a service worker is left running for every overlay webview that is
					// created.
					disableServiceWorker: true,
					retainContextWhenHidden: true,
				},
				contentOptions: {
					allowScripts: true
				},
			});

			// Add the onMessage event handler to the help overlay webview.
			this._helpOverlayWebview.onMessage(async e => {
				const message = e.message as PositronHelpMessage;
				switch (message.id) {
					// positron-help-interactive message.
					case 'positron-help-interactive':
						break;

					// positron-help-complete message.
					case 'positron-help-complete':
						if (message.title) {
							if (this._setTitleTimeout) {
								clearTimeout(this._setTitleTimeout);
								this._setTitleTimeout = undefined;
							}
							this._title = message.title;
							this._onDidChangeTitleEmitter.fire(this._title);
						}
						break;

					// positron-help-navigate message.
					case 'positron-help-navigate': {
						// Determine whether to open the URL externally; otherwise, open it in the
						// help service. This obviously isn't an exact science. At the moment, we
						// open PDFs externally.
						const url = new URL(message.url);
						if (!isLocalhost(url.hostname) || url.pathname.toLowerCase().endsWith('.pdf')) {
							try {
								await this._openerService.open(message.url, {
									openExternal: true
								} satisfies OpenExternalOptions);
							} catch {
								this._notificationService.error(localize(
									'positronHelpOpenFailed',
									"Positron was unable to open '{0}'.", message.url
								));
							}
						} else {
							this._onDidNavigateEmitter.fire(message.url);
						}
						break;
					}

					// positron-help-navigate-backward message.
					case 'positron-help-navigate-backward':
						this._onDidNavigateBackwardEmitter.fire();
						break;

					// positron-help-navigate-forward message.
					case 'positron-help-navigate-forward':
						this._onDidNavigateForwardEmitter.fire();
						break;

					// positron-help-scroll message.
					case 'positron-help-scroll':
						// Set the scroll position.
						this._scrollX = message.scrollX;
						this._scrollY = message.scrollY;
						break;

					// positron-help-find-result message.
					case 'positron-help-find-result':
						this._hasFindResultEmitter.fire(message.findResult);
						break;

					// positron-help-context-menu message.
					case 'positron-help-context-menu':
						this.showContextMenu(message.screenX, message.screenY, message.selection);
						break;

					// positron-help-keydown message.
					case 'positron-help-keydown': {
						// Determine whether the cmd or ctrl key is pressed.
						const cmdOrCtrlKey = isMacintosh ? message.metaKey : message.ctrlKey;

						// Copy.
						if (cmdOrCtrlKey && message.code === 'KeyC') {
							this._helpOverlayWebview?.postMessage({
								id: 'positron-help-copy-selection'
							});
						} else {
							// Emulate the key event.
							this.emulateKeyEvent('keydown', { ...message });
						}
						break;
					}

					// positron-help-keyup message.
					case 'positron-help-keyup':
						this.emulateKeyEvent('keyup', { ...message });
						break;

					// positron-help-copy-selection message.
					case 'positron-help-copy-selection':
						// Copy the selection to the clipboard.
						if (message.selection) {
							this._clipboardService.writeText(message.selection);
						}
						break;
				}
			});

			// Set the HTML of the help overlay webview.
			this._helpOverlayWebview.setHtml(
				this.helpHTML
					.replaceAll('__nonce__', generateNonce())
					.replaceAll('__sourceURL__', this.sourceUrl)
					.replaceAll('__scrollX__', `${this._scrollX}`)
					.replaceAll('__scrollY__', `${this._scrollY}`)
			);

			// Start the set title timeout. This timeout sets the title of the help entry to a
			// shortened version of the source URL. We do this because there's no guarantee that the
			// document will load and send its title.
			this._setTitleTimeout = setTimeout(() => {
				this._setTitleTimeout = undefined;
				this._title = shortenUrl(this.sourceUrl);
				this._onDidChangeTitleEmitter.fire(this._title);
			}, TITLE_TIMEOUT);
		}

		// Claim and layout the help overlay webview.
		this._element = element;
		this._helpOverlayWebview.claim(this._element, undefined);
		this._helpOverlayWebview.layoutWebviewOverElement(this._element);
	}

	/**
	 * Hides the help overlay webiew.
	 * @param dispose A value which indicates whether to dispose of the help overlay webiew.
	 */
	public hideHelpOverlayWebview(dispose: boolean) {
		if (this._helpOverlayWebview) {
			this.hideFind();
			if (this._element) {
				this._helpOverlayWebview.release(this._element);
				this._element = undefined;
			}
			if (dispose && !this._disposeTimeout) {
				this._disposeTimeout = setTimeout(() => {
					this._disposeTimeout = undefined;
					if (this._helpOverlayWebview) {
						this._helpOverlayWebview.dispose();
						this._helpOverlayWebview = undefined;
					}
				}, DISPOSE_TIMEOUT);
			}
		}
	}

	/**
	 * Shows find.
	 */
	public showFind() {
		this._helpOverlayWebview?.showFind(true);
	}

	/**
	 * Hides find.
	 */
	public hideFind() {
		this._helpOverlayWebview?.hideFind(true, false);
	}

	//#endregion IHelpEntry Implementation

	//#region WebviewFindDelegate Implementation

	/**
	 * A value which indicates whether to check the IME completion state.
	 */
	readonly checkImeCompletionState = true;

	/**
	 * hasFindResult event.
	 */
	readonly hasFindResult = this._hasFindResultEmitter.event;

	/**
	 * onDidStopFind event.
	 */
	readonly onDidStopFind = this._onDidStopFindEmitter.event;

	/**
	 * Finds the value.
	 * @param value The value to find.
	 * @param previous A value which indicates whether to find previous.
	 */
	public find(value: string, previous: boolean) {
		if (this._helpOverlayWebview) {
			if (previous) {
				this._helpOverlayWebview.postMessage({
					id: 'positron-help-find-previous',
					findValue: value
				});
			} else {
				this._helpOverlayWebview.postMessage({
					id: 'positron-help-find-next',
					findValue: value
				});
			}

			setTimeout(() => {
				this._helpOverlayWebview?.postMessage({
					id: 'positron-help-focus'
				});
			}, 100);
		}
	}

	/**
	 * Updates find.
	 * @param value The updated find value.
	 */
	public updateFind(value: string) {
		if (this._helpOverlayWebview) {
			this._helpOverlayWebview.postMessage({
				id: 'positron-help-update-find',
				findValue: value
			});
		}
	}

	/**
	 * Stops find.
	 * @param keepSelection A value which indicates whether to keep the selection.
	 */
	public stopFind(keepSelection?: boolean) {
		if (this._helpOverlayWebview && !keepSelection) {
			this._helpOverlayWebview.postMessage({
				id: 'positron-help-update-find',
				findValue: undefined
			});
		}
	}

	/**
	 * Focus.
	 */
	public focus() {
		// NOOP to fix https://github.com/posit-dev/positron/issues/1644.
	}

	//#endregion WebviewFindDelegate Implementation

	//#region Private Methods

	/**
	 * handleKeyEvent
	 * @param type The type (keydown or keyup).
	 * @param event The key event.
	 */
	private emulateKeyEvent(type: 'keydown' | 'keyup', event: KeyEvent) {
		// Create an emulated KeyboardEvent from the data provided.
		const emulatedKeyboardEvent = new KeyboardEvent(type, event);

		// Force override the target of the emulated KeyboardEvent.
		Object.defineProperty(emulatedKeyboardEvent, 'target', {
			get: () => this._element,
		});

		// Dispatch the emulated KeyboardEvent to the target.
		window.dispatchEvent(emulatedKeyboardEvent);
	}

	/**
	 * Shows the context menu.
	 * @param screenX The screen X.
	 * @param screenY The screen Y.
	 * @param selection The selection.
	 */
	private async showContextMenu(
		screenX: number,
		screenY: number,
		selection: string
	): Promise<void> {
		// Ensure that the element is set. (It will be.)
		if (!this._element) {
			return;
		}

		// The context menu actions.
		const actions: IAction[] = [];

		// Add the copy action.
		actions.push({
			id: POSITRON_HELP_COPY,
			label: localize('positron.console.copy', "Copy"),
			tooltip: '',
			class: undefined,
			enabled: selection.length !== 0,
			run: () => {
				// Copy the selection to the clipboard.
				if (selection) {
					this._clipboardService.writeText(selection);
				}
			}
		});

		// Because help is displayed in an overlay webview, traditional focus tracking to keep the
		// PositronHelpFocused context key up to date will not work. Instead, we need to create a
		// dynamic binding for it and make sure it's set to true while the context menu is being
		// displayed.

		// Create the scoped context key service for the Positron console container. This will be
		// disposed when the context menu is hidden.
		const scopedContextKeyService = this._contextKeyService.createScoped(this._element);

		// Create the PositronHelpFocused context key.
		const contextKey = PositronHelpFocused.bindTo(scopedContextKeyService);

		// Get the current value. If it's false, set it to true.
		const contextKeyValue = contextKey.get();
		if (!contextKeyValue) {
			contextKey.set(true);
		}

		// Show the context menu.
		const x = screenX - window.screenX;
		const y = screenY - window.screenY;
		this._contextMenuService.showContextMenu({
			getActions: () => actions,
			getAnchor: () => ({
				x,
				y
			}),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			onHide: didCancel => {
				// Restore the context key value, if we set it to true.
				if (!contextKeyValue) {
					contextKey.set(false);
				}

				// Dispose of the scoped context key service.
				scopedContextKeyService.dispose();
			},
		});
	}

	//#endregion Private Methods
}
