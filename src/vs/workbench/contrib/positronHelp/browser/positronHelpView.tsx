/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
import * as nls from 'vs/nls';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { ActionBars } from 'vs/workbench/contrib/positronHelp/browser/components/actionBars';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';
import { HelpEntry, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns A value which indicates whether a hostname represents localhost.
 */
const isLocalhost = (hostname?: string) =>
	!!(hostname && ['localhost', '127.0.0.1', '::1'].indexOf(hostname.toLowerCase()) > -1);

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
	fromUrl: string;
	toUrl: string;
};

/**
 * Message type.
 */
type Message =
	| MessageHelpLoaded
	| MessageNavigate;

/**
 * PositronHelpCommand interface.
 */
interface PositronHelpCommand {
	identifier: string;
	command: string;
	findText?: string;
}

/**
 * PositronHelpViewPane class.
 */
export class PositronHelpViewPane extends ViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The onSizeChanged emitter.
	private onSizeChangedEmitter = this._register(new Emitter<ISize>());

	// The onVisibilityChanged event emitter.
	private onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	// The onSaveScrollPosition emitter.
	private onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	// The onRestoreScrollPosition emitter.
	private onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	// The onFocused emitter.
	private onFocusedEmitter = this._register(new Emitter<void>());

	// The width. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _width = 0;

	// The height. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _height = 0;

	// The Positron help container - contains the entire Positron help UI.
	private positronHelpContainer: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private helpActionBarsContainer: HTMLElement;

	// The PositronReactRenderer for the PositronHelpActionBars component.
	private positronReactRendererHelpActionBars?: PositronReactRenderer;

	// The container for the help webview.
	private helpViewContainer: HTMLElement;

	// The help overlay webview.
	private helpOverlayWebview?: IOverlayWebview;

	// The last Positron help command that was sent to the help iframe.
	private lastPositronHelpCommand?: PositronHelpCommand;

	//#endregion Private Properties

	//#region IReactComponentContainer

	/**
	 * Gets the width.
	 */
	get width() {
		return this._width;
	}

	/**
	 * Gets the height.
	 */
	get height() {
		return this._height;
	}

	/**
	 * Gets the visible state.
	 */
	get visible() {
		return this.isBodyVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void {
		this.focus();
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this.onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this.onVisibilityChangedEmitter.event;

	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> = this.onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> = this.onRestoreScrollPositionEmitter.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this.onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options The IViewPaneOptions for the view pane.
	 * @param commandService The ICommandService.
	 * @param configurationService The IConfigurationService.
	 * @param contextKeyService The IContextKeyService.
	 * @param contextMenuService The IContextMenuService.
	 * @param instantiationService The IInstantiationService.
	 * @param keybindingService The IKeybindingService.
	 * @param openerService The IOpenerService.
	 * @param positronHelpService The IPositronHelpService.
	 * @param telemetryService The ITelemetryService.
	 * @param themeService The IThemeService.
	 * @param viewDescriptorService The IViewDescriptorService.
	 * @param webviewService The IWebviewService.
	 */
	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IPositronHelpService private readonly positronHelpService: IPositronHelpService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWebviewService private readonly webviewService: IWebviewService,
	) {
		// Call the base class's constructor.
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			telemetryService
		);

		// Create containers.
		this.positronHelpContainer = DOM.$('.positron-help-container');
		this.helpActionBarsContainer = DOM.$('.help-action-bars-container');
		this.helpViewContainer = DOM.$('.positron-help-view-container');

		// Append the help action bars container and help view container to the help container.
		this.positronHelpContainer.appendChild(this.helpActionBarsContainer);
		this.positronHelpContainer.appendChild(this.helpViewContainer);

		// Register the onRenderHelp event handler.
		this._register(this.positronHelpService.onRenderHelp(helpEntry => {
			// Ensure that the overlay webview has been created.
			this.createOverlayWebview();

			// Open the help entry.
			this.openHelpEntry(helpEntry);
		}));

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			// If the help overlay webview has been created, claim it and lay it out when this view
			// is visible; otherwise, release it when this view is not visible.
			if (this.helpOverlayWebview) {
				if (visible) {
					this.claimAndLayoutHelpOverlayWebview();
				} else {
					this.helpOverlayWebview.release(this);
				}
			}

			// Fire the onVisibilityChanged event.
			this.onVisibilityChangedEmitter.fire(visible);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Release the help overlay webview.
		if (this.helpOverlayWebview) {
			this.helpOverlayWebview.release(this);
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region ViewPane Overrides

	/**
	 * renderBody override method.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron help container.
		container.appendChild(this.positronHelpContainer);

		// Home handler.
		const homeHandler = () => {
		};

		// Find handler.
		const findHandler = (findText: string) => {
		};

		// Find handler.
		const checkFindResultsHandler = () => {
			if (this.lastPositronHelpCommand) {
				console.log('TODO');
			}
			// if (this._helpView?.contentWindow && this._lastPositronHelpCommand) {
			// 	const result = this._helpView.contentWindow.sessionStorage.getItem(this._lastPositronHelpCommand.identifier);
			// 	if (result) {
			// 		return result === 'true';
			// 	}
			// }

			// Result is not available.
			return undefined;
		};

		// Find previous handler.
		const findPrevious = () => {
			this.postHelpIFrameMessage({ identifier: generateUuid(), command: 'find-previous' });
		};

		// Find next handler.
		const findNext = () => {
			this.postHelpIFrameMessage({ identifier: generateUuid(), command: 'find-next' });
		};

		// Create and register the PositronReactRenderer for the action bars.
		this.positronReactRendererHelpActionBars = new PositronReactRenderer(this.helpActionBarsContainer);
		this._register(this.positronReactRendererHelpActionBars);

		// Render the ActionBars component.
		this.positronReactRendererHelpActionBars.render(
			<ActionBars
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				positronHelpService={this.positronHelpService}
				reactComponentContainer={this}
				onHome={homeHandler}
				onFind={findHandler}
				onCheckFindResults={checkFindResultsHandler}
				onFindPrevious={findPrevious}
				onFindNext={findNext}
				onCancelFind={() => findHandler('')}
			/>
		);

		// Get the current help entry. If there is one, create the help overlay webview and open it.
		const currentHelpEntry = this.positronHelpService.currentHelpEntry;
		if (currentHelpEntry) {
			this.createOverlayWebview();
			this.openHelpEntry(currentHelpEntry);
		}
	}

	/**
	 * focus override method.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();

		// Fire the onFocused event.
		this.onFocusedEmitter.fire();
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	protected override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Raise the onSizeChanged event.
		this.onSizeChangedEmitter.fire({
			width,
			height
		});

		// Layout the overlay webview.
		this.helpOverlayWebview?.layoutWebviewOverElement(this.helpViewContainer);
	}

	//#endregion ViewPane Overrides

	//#region Private Methods

	/**
	 * Creates the overlay webview.
	 */
	private createOverlayWebview() {
		// If the overlay webview exists, do nothing.
		if (this.helpOverlayWebview) {
			return;
		}

		// Create and register the help overlay webview.
		this.helpOverlayWebview = this.webviewService.createWebviewOverlay({
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
		this._register(this.helpOverlayWebview);

		// Add the onMessage event handler to the help overlay webview.
		this._register(this.helpOverlayWebview.onMessage(async e => {
			const message = e.message as Message;
			switch (message.id) {
				// help-loaded message.
				case 'positron-help-loaded': {
					await this.positronHelpService.helpLoaded(message.url, message.title || message.url);
					break;
				}

				// navigate message.
				case 'positron-help-navigate': {
					// If the to URL is external, open it externally; otherwise, open it in the help
					// service.
					const toUrl = new URL(message.toUrl);
					if (!isLocalhost(toUrl.hostname)) {
						try {
							await this.openerService.open(message.toUrl, {
								openExternal: true
							} satisfies OpenExternalOptions);
						} catch {
							this.notificationService.error(nls.localize(
								'positronHelpOpenFailed',
								"Positron was unable to open '{0}'.", message.toUrl
							));
						}
					} else {
						// Get the current help entry.
						this.positronHelpService.navigate(message.fromUrl, message.toUrl);
					}
					break;
				}
			}
		}));

		// Claim and lay out the help overlay webview.
		this.claimAndLayoutHelpOverlayWebview();
	}

	/**
	 * Claims and lays out the help overlay webview.
	 */
	private claimAndLayoutHelpOverlayWebview() {
		// Claim the help overlay webview and lay it out.
		if (this.helpOverlayWebview) {
			this.helpOverlayWebview.claim(this, undefined);
			this.helpOverlayWebview.layoutWebviewOverElement(this.helpViewContainer);
		}
	}

	/**
	 * Opens a help entry.
	 * @param helpEntry The help URL.
	 */
	private openHelpEntry(helpEntry: HelpEntry) {
		this.helpOverlayWebview?.setHtml(this.generateHelpHtml(helpEntry.sourceUrl));
	}

	/**
	 * Posts a message to the help iframe.
	 * @param positronHelpCommand The PositronHelpCommand to post.
	 */
	private postHelpIFrameMessage(positronHelpCommand: PositronHelpCommand): void {
		// Post the message to the help iframe.
		//this._helpView?.postMessage(positronHelpCommand);

		// Save the command?
		if (positronHelpCommand.command === 'find' && positronHelpCommand.findText) {
			this.lastPositronHelpCommand = positronHelpCommand;
		} else {
			this.lastPositronHelpCommand = undefined;
		}
	}

	/**
	 * Generates help HTML.
	 * @param url The URL of the help to display in the help HTML.
	 * @returns The help HTML.
	 */
	private generateHelpHtml(url: string) {
		// Render the help document.
		const nonce = generateUuid();
		return `
<!DOCTYPE html>
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
		<iframe id="help-iframe" title="Help Content" src="${url}" loading="eager">
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
