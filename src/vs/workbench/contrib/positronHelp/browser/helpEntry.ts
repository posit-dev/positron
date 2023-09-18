/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { isLocalhost } from 'vs/workbench/contrib/positronHelp/browser/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Constants.
 */
const TITLE_TIMEOUT = 1000;
const DISPOSE_TIMEOUT = 15 * 1000;

/**
 * Shortens a URL.
 * @param url The URL.
 * @returns The shortened URL.
 */
const shortenUrl = (url: string) => url.replace(new URL(url).origin, '');

/**
 * PositronHelpMessageInteractive type.
 */
type PositronHelpMessageInteractive = {
	id: 'positron-help-interactive';
};

/**
 * PositronHelpMessageComplete type.
 */
type PositronHelpMessageComplete = {
	id: 'positron-help-complete';
	url: string;
	title?: string;
};

/**
 * PositronHelpMessageNavigate type.
 */
type PositronHelpMessageNavigate = {
	id: 'positron-help-navigate';
	url: string;
};

/**
 * PositronHelpScroll type.
 */
type PositronHelpMessageScroll = {
	id: 'positron-help-scroll';
	scrollX: number;
	scrollY: number;
};

/**
 * PositronHelpMessage type.
 */
type PositronHelpMessage =
	| PositronHelpMessageInteractive
	| PositronHelpMessageComplete
	| PositronHelpMessageNavigate
	| PositronHelpMessageScroll;

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
	 * Shows the help overlay webiew.
	 * @param element The element over which to show the help overlay webiew.
	 */
	showHelpOverlayWebview(element: HTMLElement): void;

	/**
	 * Hides the help overlay webiew.
	 * @param dispose A value which indicates whether to dispose of the help overlay webiew.
	 */
	hideHelpOverlayWebview(dispose: boolean): void;
}

/**
 * HelpEntry class.
 */
export class HelpEntry extends Disposable implements IHelpEntry {
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

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param helpHTML The help HTML.
	 * @param languageId The language ID.
	 * @param runtimeId The runtime ID.
	 * @param languageName The language name.
	 * @param sourceUrl The source URL.
	 * @param targetUrl The target URL.
	 * @param _notificationService The INotificationService.
	 * @param _openerService The IOpenerService.
	 * @param _webviewService the IWebviewService.
	 */
	constructor(
		public readonly helpHTML: string,
		public readonly languageId: string,
		public readonly runtimeId: string,
		public readonly languageName: string,
		public readonly sourceUrl: string,
		public readonly targetUrl: string,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		super();
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
	 * Shows the help overlay webiew.
	 * @param element The element over which to show the help overlay webiew.
	 */
	public showHelpOverlayWebview(element: HTMLElement) {
		// If the dispose timeout is running, clear it.
		if (this._disposeTimeout) {
			clearTimeout(this._disposeTimeout);
			this._disposeTimeout = undefined;
		}

		if (!this._helpOverlayWebview) {
			// Create the help overlay webview. Register it for disposal.
			this._helpOverlayWebview = this._webviewService.createWebviewOverlay({
				title: 'Positron Help',
				extension: {
					id: new ExtensionIdentifier('positron-help'),
				},
				options: {
					purpose: WebviewContentPurpose.WebviewView,
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
					case 'positron-help-navigate':
						// If the to URL is external, open it externally; otherwise, open it in the help
						// service.
						if (!isLocalhost(new URL(message.url).hostname)) {
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

					// positron-help-scroll message.
					case 'positron-help-scroll':
						// Set the scroll position.
						this._scrollX = message.scrollX;
						this._scrollY = message.scrollY;
						//console.log(`positron-help-scroll ${this._scrollX},${this._scrollY}`);
						break;
				}
			});

			// Set the HTML of the help overlay webview.
			this._helpOverlayWebview.setHtml(
				this.helpHTML
					.replaceAll('__nonce__', generateUuid())
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
		this._helpOverlayWebview.claim(this, undefined);
		this._helpOverlayWebview.layoutWebviewOverElement(element);
	}

	/**
	 * Hides the help overlay webiew.
	 * @param dispose A value which indicates whether to dispose of the help overlay webiew.
	 */
	public hideHelpOverlayWebview(dispose: boolean) {
		if (this._helpOverlayWebview) {
			this._helpOverlayWebview.release(this);
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

	//#endregion IHelpEntry Implementation
}
