/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { generateUuid } from 'vs/base/common/uuid';
import { Disposable } from 'vs/base/common/lifecycle';
import { isLocalhost } from 'vs/workbench/contrib/positronHelp/browser/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Shortens a URL.
 * @param url The URL.
 * @returns The shortened URL.
 */
const shortenUrl = (url: string) => url.replace(new URL(url).origin, '');

/**
 * MessageHelpLoaded type.
 */
type MessageHelpLoaded = {
	id: 'positron-help-loaded';
	url: string;
	title?: string;
};

/**
 * MessageNavigate type.
 */
type MessageNavigate = {
	id: 'positron-help-navigate';
	url: string;
};

/**
 * Message type.
 */
type Message =
	| MessageHelpLoaded
	| MessageNavigate;

/**
 * HelpEntry class.
 */
export class HelpEntry extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets the title.
	 */
	private _title?: string;

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
		// Release the help overlay webview.
		if (this._setTitleTimeout) {
			clearTimeout(this._setTitleTimeout);
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	get title() {
		return this._title;
	}

	get helpOverlayWebview() {
		// If the help overlay webview has been created, return it.
		if (this._helpOverlayWebview) {
			return this._helpOverlayWebview;
		}

		// Create the help overlay webview. Register it for disposal.
		this._helpOverlayWebview = this._webviewService.createWebviewOverlay({
			title: 'Positron Help',
			extension: {
				id: new ExtensionIdentifier('positron-help'),
			},
			options: {
				purpose: WebviewContentPurpose.WebviewView,
				retainContextWhenHidden: true
			},
			contentOptions: {
				allowScripts: true,
				allowMultipleAPIAcquire: true,
				localResourceRoots: [], // TODO: needed for positron-help.js
			},
		});
		this._register(this._helpOverlayWebview);

		// Add the onMessage event handler to the help overlay webview. Register it for disposal.
		this._register(this._helpOverlayWebview.onMessage(async e => {
			const message = e.message as Message;
			switch (message.id) {
				// positron-help-loaded message.
				case 'positron-help-loaded': {
					if (this._setTitleTimeout) {
						clearTimeout(this._setTitleTimeout);
						this._setTitleTimeout = undefined;
					}
					this._title = message.title || shortenUrl(this.sourceUrl);
					this._onDidChangeTitleEmitter.fire(this._title);
					break;
				}

				// positron-help-navigate message.
				case 'positron-help-navigate': {
					// If the to URL is external, open it externally; otherwise, open it in the help
					// service.
					const toUrl = new URL(message.url);
					if (!isLocalhost(toUrl.hostname)) {
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
			}
		}));

		// Set the HTML of the help overlay webview.
		this._helpOverlayWebview.setHtml(this.generateHelpHtml());

		// Start the set title timeout.
		this._setTitleTimeout = setTimeout(() => {
			this._title = shortenUrl(this.sourceUrl);
			this._onDidChangeTitleEmitter.fire(this._title);
			this._setTitleTimeout = undefined;
		}, 1000);

		// Return the help overlay webview.
		return this._helpOverlayWebview;
	}

	//#endregion Public Properties

	/**
	 * The onDidChangeTitle event.
	 */
	readonly onDidChangeTitle = this._onDidChangeTitleEmitter.event;

	/**
	 * The onDidNavigate event.
	 */
	readonly onDidNavigate = this._onDidNavigateEmitter.event;

	//#region Private Methods

	/**
	 * Generates help HTML.
	 * @param helpEntry The HelpEntry to generate HTML for.
	 * @returns The help HTML.
	 */
	private generateHelpHtml() {
		// Generate and return a help document that loads the help entry's source URL.
		const nonce = generateUuid();
		return `<!DOCTYPE html>
<html>
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
		<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src https:; script-src 'self' 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-src *;">
		<style nonce="${nonce}">
			body {
				padding: 0;
			}
			#help-iframe {
				border: none;
				width: 100%;
				height: 100%;
				position: absolute;
			}
		</style>
	</head>
	<body>
		<iframe id="help-iframe" title="Help Content" src="${this.sourceUrl}" loading="eager">
		</iframe>
		<script nonce="${nonce}">
		(() => {
			const vscode = acquireVsCodeApi();
			const childWindow = document.getElementById('help-iframe').contentWindow;
			window.addEventListener('message', (message) => {
				if (message.source === childWindow) {
					if (message.data.id.startsWith("positron-help-")) {
						vscode.postMessage(message.data);
					}
				}
			});
		})();
		</script>
	</body>
</html>`;
	}

	//#endregion Private Methods
}
