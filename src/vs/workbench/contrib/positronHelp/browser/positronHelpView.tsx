/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { generateUuid } from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
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
import { ActionBars } from 'vs/workbench/contrib/positronHelp/browser/components/actionBars';
import { IWebviewElement, IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';

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
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	// The onVisibilityChanged event emitter.
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	// The onSaveScrollPosition emitter.
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	// The onRestoreScrollPosition emitter.
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	// The onFocused emitter.
	private _onFocusedEmitter = this._register(new Emitter<void>());

	// The width. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _width = 0;

	// The height. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _height = 0;

	// The Positron help container - contains the entire Positron help UI.
	private _positronHelpContainer: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private _helpActionBarsContainer: HTMLElement;

	// The PositronReactRenderer for the PositronHelpActionBars component.
	private _positronReactRendererHelpActionBars?: PositronReactRenderer;

	// The container for the help webview.
	private _helpViewContainer: HTMLElement;

	// The help iframe.
	private _helpWebviewElement: IWebviewElement | undefined;

	// The last Positron help command that was sent to the help iframe.
	private _lastPositronHelpCommand?: PositronHelpCommand;

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
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

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
		this._positronHelpContainer = DOM.$('.positron-help-container');
		this._helpActionBarsContainer = DOM.$('.help-action-bars-container');
		this._helpViewContainer = DOM.$('.positron-help-view-container');
		this._helpViewContainer.style.width = '100%';
		this._helpViewContainer.style.height = '100%';

		// Arrange our elements.
		this._positronHelpContainer.appendChild(this._helpActionBarsContainer);
		this._positronHelpContainer.appendChild(this._helpViewContainer);

		this._register(this.positronHelpService.onRenderHelp(helpDescriptor => {
			if (this._helpWebviewElement) {
				const html = this.shit(helpDescriptor.url);
				this._helpWebviewElement.setHtml(html);
			}
		}));

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			this.onDidChangeVisibility(visible);
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	private shit(url: string) {

		console.log(`HELP URL!!! ${url}`);

		const nonce = generateUuid();

		// Render the help document.
		return `
<!DOCTYPE html>
<html>
	<head>
		<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
		<meta http-equiv="Content-Security-Policy" content="
			default-src 'none';
			media-src https:;
			script-src 'self' 'nonce-${nonce}';
			style-src 'nonce-${nonce}';
			frame-src *;
		">
		<style nonce="${nonce}">
			body {
				padding: 0;
				width: 100%;
				height: 100%;
				display: flex;
				font-size: 13px;
				background: white;
				flex-direction: column;
				font-family: sans-serif;
			}
			#help-iframe {
				width: 100%;
				height = 100%;
				border: none;
			}
		</style>
		<script nonce="${nonce}">
			console.log('THE ROOT SCRIPT GOT LOADED');
		</script>
	</head>
	<body>
		<div>sparta sparta</div>
		<iframe id="help-iframe" src="${url}"></iframe>

		<script nonce="${nonce}">
		(function() {
			let findText = undefined;
			let findResult = false;

			// Set up iframe.
			const frame = document.getElementById("help-iframe");
			// frame.style.width = "100%";
			// frame.style.height = "100%";
			// frame.style.border = "none";
			// frame.src = "${url}";

			// TODO: Not clear why this is necessary
			document.documentElement.style.width = "100%";
			document.documentElement.style.height = "100%";

			window.addEventListener('message', (event) => {
				if (window.find) {
					if (event.data.command === 'find') {
						findText = event.data.findText;
						findResult = findText && frame.contentWindow.find(findText, false, false, true, false, true);

						console.log('find command was received');
						console.log('findText: ' + findText);
						console.log('findResult: ' + findResult);

						if (findResult) {
							window.sessionStorage.setItem(event.data.identifier, 'true');
						} else {
							window.sessionStorage.setItem(event.data.identifier, 'false');
						}
						if (findResult) {
							window.focus();
						} else {
							window.getSelection().removeAllRanges();
						}
					} else if (event.data.command === 'find-previous') {
						if (findResult) {
							window.find(findText, false, true, false, false, true);
							window.focus();
						}
					} else if (event.data.command === 'find-next') {
						if (findResult) {
							window.find(findText, false, false, false, false, true);
							window.focus();
						}
					}
				}
			}, false);

		})();
		</script>
	</body>
</html>`;
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Destroy the PositronReactRenderer for the ActionBars component.
		if (this._positronReactRendererHelpActionBars) {
			this._positronReactRendererHelpActionBars.destroy();
			this._positronReactRendererHelpActionBars = undefined;
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
		container.appendChild(this._positronHelpContainer);

		// Home handler.
		const homeHandler = () => {
			// // Test code for now to render some kind of help markdown.
			// this.positronHelpService.openHelpMarkdown(new MarkdownString(
			// 	`This is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\n***The Real End***\n\n`
			// ));
		};

		// Find handler.
		const findHandler = (findText: string) => {
			//this._helpView.showFind(true);

			//this.postHelpIFrameMessage({ identifier: generateUuid(), command: 'find', findText });
		};

		// Find handler.
		const checkFindResultsHandler = () => {

			if (this._lastPositronHelpCommand) {
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
		this._positronReactRendererHelpActionBars = new PositronReactRenderer(this._helpActionBarsContainer);
		this._positronReactRendererHelpActionBars.render(
			<ActionBars
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				reactComponentContainer={this}
				onPreviousTopic={() => console.log('Previous topic made it to the Positron help view.')}
				onNextTopic={() => console.log('Next topic made it to the Positron help view.')}
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
		this._onFocusedEmitter.fire();
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
		this._onSizeChangedEmitter.fire({
			width,
			height
		});
	}

	//#endregion ViewPane Overrides

	//#region Private Methods

	/**
	 * Posts a message to the help iframe.
	 * @param positronHelpCommand The PositronHelpCommand to post.
	 */
	private postHelpIFrameMessage(positronHelpCommand: PositronHelpCommand): void {
		// Post the message to the help iframe.
		//this._helpView?.postMessage(positronHelpCommand);

		// Save the command?
		if (positronHelpCommand.command === 'find' && positronHelpCommand.findText) {
			this._lastPositronHelpCommand = positronHelpCommand;
		} else {
			this._lastPositronHelpCommand = undefined;
		}
	}

	private onDidChangeVisibility(visible: boolean): void {
		if (visible) {
			if (this._helpWebviewElement) {
				return;
			}

			this._helpWebviewElement = this.webviewService.createWebviewElement({
				title: 'Positron Help',
				extension: {
					id: new ExtensionIdentifier('positron-help'),
				},
				options: {},
				contentOptions: {
					allowScripts: true,
					localResourceRoots: [], // TODO: needed for positron-help.js
				},
			});

			this._helpWebviewElement.mountTo(this._helpViewContainer);

			const dd = this.positronHelpService.yack();
			if (dd) {
				const html = this.shit(dd);
				this._helpWebviewElement.setHtml(html);
			}
		} else {
			if (this._helpWebviewElement) {
				this._helpWebviewElement.dispose();
				this._helpWebviewElement = undefined;
			}
		}
	}

	//#endregion Private Methods
}
