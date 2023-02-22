/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import * as uuid from 'vs/base/common/uuid';
import { Event, Emitter } from 'vs/base/common/event';
import { MarkdownString } from 'vs/base/common/htmlContent';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ActionBars } from 'vs/workbench/contrib/positronHelp/browser/components/actionBars';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IWebviewElement, IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

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

	// The onVisibilityChanged emitter.
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	// The onFocused emitter.
	private _onFocusedEmitter = this._register(new Emitter<void>());

	// The width. This valus is set in layoutBody and is used to implement the IReactComponentContainer interface.
	private _width = 0;

	// The height. This valus is set in layoutBody and is used to implement the IReactComponentContainer interface.
	private _height = 0;

	// The Positron help container - contains the entire Positron help UI.
	private _positronHelpContainer: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private _helpActionBarsContainer: HTMLElement;

	// The PositronReactRenderer for the ActionBars component.
	private _positronReactRendererActionBars?: PositronReactRenderer;

	// The host for the Help webview.
	private _helpViewContainer: HTMLElement;

	// The help iframe.
	private _helpView: IWebviewElement;

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
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

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
		@IWebviewService webviewService: IWebviewService,
	) {
		// Call the base class's constructor.
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		// Create containers.
		this._positronHelpContainer = DOM.$('.positron-help-container');
		this._helpActionBarsContainer = DOM.$('.help-action-bars-container');
		this._helpViewContainer = DOM.$('.positron-help-view-container');
		this._helpViewContainer.style.width = '100%';
		this._helpViewContainer.style.height = '100%';

		// Create the help view.
		this._helpView = webviewService.createWebviewElement({
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

		// Arrange our elements.
		this._positronHelpContainer.appendChild(this._helpActionBarsContainer);
		this._positronHelpContainer.appendChild(this._helpViewContainer);
		this._helpView.mountTo(this._helpViewContainer);

		// Register event handlers.
		this._register(this.onDidChangeBodyVisibility(() => {
			this._onVisibilityChangedEmitter.fire(this.isBodyVisible());
		}));

		this._register(this.positronHelpService.onRenderHelp(html => {
			this._helpView.setHtml(html);
		}));
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Destroy the PositronReactRenderer for the ActionBars component.
		if (this._positronReactRendererActionBars) {
			this._positronReactRendererActionBars.destroy();
			this._positronReactRendererActionBars = undefined;
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
			// Test code for now to render some kind of help markdown.
			this.positronHelpService.openHelpMarkdown(new MarkdownString(
				`This is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\nThis is help text ${new Date().toTimeString()}.\n\nHere is some **bold text**.\n\nHere is a list:\n\n* One.\n* Two.\n* Three.\n\n***The Real End***\n\n`
			));
		};

		// Find handler.
		const findHandler = (findText: string) => {
			this.postHelpIFrameMessage({ identifier: uuid.generateUuid(), command: 'find', findText });
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
			this.postHelpIFrameMessage({ identifier: uuid.generateUuid(), command: 'find-previous' });
		};

		// Find next handler.
		const findNext = () => {
			this.postHelpIFrameMessage({ identifier: uuid.generateUuid(), command: 'find-next' });
		};

		// Render the ActionBars component.
		this._positronReactRendererActionBars = new PositronReactRenderer(this._helpActionBarsContainer);
		this._positronReactRendererActionBars.render(
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
	override layoutBody(height: number, width: number): void {
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
		this._helpView.postMessage(positronHelpCommand);

		// Save the command?
		if (positronHelpCommand.command === 'find' && positronHelpCommand.findText) {
			this._lastPositronHelpCommand = positronHelpCommand;
		} else {
			this._lastPositronHelpCommand = undefined;
		}

	}

	//#endregion Private Methods
}
