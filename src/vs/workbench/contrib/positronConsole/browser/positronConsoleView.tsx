/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronConsoleView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { PixelRatio } from 'vs/base/browser/browser';
import { Event, Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { IModelService } from 'vs/editor/common/services/model';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronConsole } from 'vs/workbench/contrib/positronConsole/browser/positronConsole';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';

/**
 * PositronConsoleViewPane class.
 */
export class PositronConsoleViewPane extends ViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The onSizeChanged emitter.
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	// The onVisibilityChanged emitter.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());

	// The onFocused emitter.
	private _onFocusedEmitter = this._register(new Emitter<void>());

	// The width. This valus is set in layoutBody and is used to implement the IReactComponentContainer interface.
	private _width = 0;

	// The height. This valus is set in layoutBody and is used to implement the IReactComponentContainer interface.
	private _height = 0;

	// The Positron console container - contains the entire Positron console UI.
	private _positronConsoleContainer!: HTMLElement;

	// The PositronReactRenderer for the PositronConsole component.
	private _positronReactRenderer: PositronReactRenderer | undefined;

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
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options View pane options.
	 * @param commandService The command service.
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param executionHistoryService The execution history service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param languageRuntimeService The language runtime service.
	 * @param languageService The language service.
	 * @param logService The log service.
	 * @param modelService The model service.
	 * @param openerService The opener service.
	 * @param positronConsoleService The Positron console service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 * @param viewDescriptorService The view descriptor service.
	 * @param workbenchLayoutService The workbench layout service.
	 */
	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExecutionHistoryService private readonly executionHistoryService: IExecutionHistoryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService private readonly languageService: ILanguageService,
		@ILogService private readonly logService: ILogService,
		@IModelService private readonly modelService: IModelService,
		@IOpenerService openerService: IOpenerService,
		@IPositronConsoleService private readonly positronConsoleService: IPositronConsoleService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly workbenchLayoutService: IWorkbenchLayoutService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));

		// Listen for focus events from ViewPane
		this.onDidFocus(() => {
			//console.log('----------> PositronConsoleViewPane was focused');
		});
	}

	/**
	 * Dispose.
	 */
	public override dispose(): void {
		// Destroy the PositronReactRenderer for the PositronConsole component.
		if (this._positronReactRenderer) {
			this._positronReactRenderer.destroy();
			this._positronReactRenderer = undefined;
		}

		// Call the base class's method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Overrides

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Get the editor options and read the font info.
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		const fontInfo = FontMeasurements.readFontInfo(
			BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value)
		);

		// Append the Positron console container. Apply the font info to it.
		this._positronConsoleContainer = DOM.$('.positron-console-container');
		this._positronConsoleContainer.setAttribute('user-select', 'all');
		container.appendChild(this._positronConsoleContainer);
		applyFontInfo(this._positronConsoleContainer, fontInfo);

		// Add the configuration change event handler so we can detect font-related changes in the
		// editor configuration.
		this._register(
			this.configurationService.onDidChangeConfiguration(configurationChangeEvent => {
				// When something in the editor changes, determine whether it's font-related and, if it
				// is, apply the new font info to the container.
				if (configurationChangeEvent.affectsConfiguration('editor')) {
					if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
						configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
						configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
						configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
						configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
						configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
						configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
					) {
						// Get the editor options and read the font info.
						const fontInfo = FontMeasurements.readFontInfo(
							BareFontInfo.createFromRawSettings(
								this.configurationService.getValue<IEditorOptions>('editor'),
								PixelRatio.value
							)
						);

						// Apply the font info to the Positron environment container.
						applyFontInfo(this._positronConsoleContainer, fontInfo);
					}
				}
			})
		);

		// Render the Positron console.
		this._positronReactRenderer = new PositronReactRenderer(this._positronConsoleContainer);
		this._positronReactRenderer.render(
			<PositronConsole
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				executionHistoryService={this.executionHistoryService}
				instantiationService={this.instantiationService}
				keybindingService={this.keybindingService}
				languageRuntimeService={this.languageRuntimeService}
				languageService={this.languageService}
				logService={this.logService}
				modelService={this.modelService}
				positronConsoleService={this.positronConsoleService}
				workbenchLayoutService={this.workbenchLayoutService}
				reactComponentContainer={this}
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

		this._positronConsoleContainer.style.width = `${width}px`;
		this._positronConsoleContainer.style.height = `${height}px`;

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChangedEmitter.fire({
			width,
			height
		});
	}

	//#endregion Public Overrides

	//#region Private Methods

	// TODO@softwarenerd - Figure out what, if anything, to do here.
	private onDidChangeVisibility(visible: boolean): void {
	}

	//#endregion Overrides
}

