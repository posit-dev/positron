/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
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
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IOpenerService, OpenExternalOptions } from 'vs/platform/opener/common/opener';
import { ActionBars } from 'vs/workbench/contrib/positronHelp/browser/components/actionBars';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { IOverlayWebview, IWebviewService, WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';

/**
 * Determines whether a hostname represents localhost.
 * @param hostname The hostname.
 * @returns A value which indicates whether a hostname represents localhost.
 */
const isLocalhost = (hostname?: string) =>
	!!(hostname && ['localhost', '127.0.0.1', '::1'].indexOf(hostname.toLowerCase()) > -1);

/**
 * MessageOpenUrl interface.
 */
type MessageOpenUrl = {
	command: 'open-url';
	href: string;
};

/**
 * Message type.
 */
type Message = | MessageOpenUrl;

/**
 * Determines whether the specified message is a MessageOpenUrl.
 * @param message The message.
 * @returns The MessageOpenUrl if the specified message is a MessageOpenUrl; otherwise, undefined.
 */
const AsMessageOpenUrl = (message: Message): MessageOpenUrl | undefined => {
	return message.command === 'open-url' ? message as MessageOpenUrl : undefined;
};

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

	private history: string[] = [];

	private historyIndex = 0;

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
		this._register(this.positronHelpService.onRenderHelp(helpDescriptor => {
			// Ensure that the overlay webview has been created.
			this.createOverlayWebview();

			// Open the help URL.
			this.openHelpUrl(helpDescriptor.url);
		}));

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			this.onDidChangeVisibility(visible);
			this.onVisibilityChangedEmitter.fire(visible);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Destroy the PositronReactRenderer for the ActionBars component.
		if (this.positronReactRendererHelpActionBars) {
			this.positronReactRendererHelpActionBars.destroy();
			this.positronReactRendererHelpActionBars = undefined;
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

		// Render the ActionBars component.
		this.positronReactRendererHelpActionBars = new PositronReactRenderer(this.helpActionBarsContainer);
		this.positronReactRendererHelpActionBars.render(
			<ActionBars
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				reactComponentContainer={this}
				onPreviousTopic={() => {
					if (this.historyIndex > 0) {
						this.openHelpUrl(this.history[--this.historyIndex]);
					}
				}}
				onNextTopic={() => {
					if (this.historyIndex < this.history.length - 1) {
						this.openHelpUrl(this.history[++this.historyIndex]);
					}
				}}
				onHome={homeHandler}
				onFind={findHandler}
				onCheckFindResults={checkFindResultsHandler}
				onFindPrevious={findPrevious}
				onFindNext={findNext}
				onCancelFind={() => findHandler('')}
			/>
		);
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

		// Create the help overlay webview.
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
				localResourceRoots: [], // TODO: needed for positron-help.js
			},
		});
		this.helpOverlayWebview.claim(this, undefined);
		this.helpOverlayWebview.layoutWebviewOverElement(this.helpViewContainer);
		this._register(this.helpOverlayWebview.onMessage(e => {
			// Get the message.
			const childMessageOpenUrl = AsMessageOpenUrl(e.message);
			if (childMessageOpenUrl) {
				// Get the help URL.
				const helpURL = new URL(childMessageOpenUrl.href);

				// If the help URL is not for localhost, open it externally; otherwise, open it
				// in the help view.
				if (!isLocalhost(helpURL.hostname)) {
					this.openerService.open(helpURL.toString(), {
						openExternal: true
					} satisfies OpenExternalOptions);
				} else {
					// Open the help URL.
					this.openHelpUrl(childMessageOpenUrl.href);
				}
			}
		}));
	}

	/**
	 * Opens a help URL.
	 * @param url The help URL.
	 */
	private openHelpUrl(url: string) {
		// See if the history contains the specified URL. If it does, remove it because it will be
		// added to the history at the end.
		const index = this.history.indexOf(url);
		if (index > -1) {
			this.history.splice(index, 1);
		}

		// Push the history entry for the help URL.
		this.history.push(url);
		this.historyIndex = this.history.length - 1;

		// Set the help HTML.
		this.helpOverlayWebview?.setHtml(this.generateHelpHtml(url));
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
	 * onDidChangeVisibility event handler.
	 * @param visible A value which indicates visibility.
	 */
	private onDidChangeVisibility(visible: boolean): void {
		if (!this.helpOverlayWebview) {
			return;
		}

		if (visible) {
			this.helpOverlayWebview.claim(this, undefined);
			this.helpOverlayWebview.layoutWebviewOverElement(this.helpViewContainer);
		} else {
			this.helpOverlayWebview.release(this);
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
		<script nonce="${nonce}">
		console.log("HEAD script");
		</script>
	</head>
	<body>
		<iframe id="help-iframe" title="Help Content" src="${url}"></iframe>
		<script nonce="${nonce}">
		(function() {
			const vscode = acquireVsCodeApi();
			const childWindow = document.getElementById('help-iframe').contentWindow;
			window.addEventListener('message', (message) => {
				if (message.source === childWindow) {
					if (message.data.command === "open-url") {
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
