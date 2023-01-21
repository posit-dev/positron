/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronConsoleView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { ILogService } from 'vs/platform/log/common/log';
import { IModelService } from 'vs/editor/common/services/model';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronConsole } from 'vs/workbench/contrib/positronConsole/browser/positronConsole';
import { IPositronConsoleService } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IExecutionHistoryService } from 'vs/workbench/contrib/executionHistory/common/executionHistoryService';

/**
 * PositronConsoleViewPane class.
 */
export class PositronConsoleViewPane extends ViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());

	// The last known height.
	private _height = 0;

	// The Positron console container - contains the entire Positron console UI.
	private _positronConsoleContainer!: HTMLElement;

	// The PositronReactRenderer for the PositronConsole component.
	private _positronReactRenderer: PositronReactRenderer | undefined;

	//#endregion Private Properties

	//#region IReactComponentContainer

	/**
	 * Gets the height.
	 */
	get height() {
		return this._height;
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

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
			console.log('----------> PositronConsoleViewPane was focused');
			// if (this._activeReplInstanceEntry) {
			// 	this._activeReplInstanceEntry.replInstanceView.takeFocus();
			// }
		});
	}

	/**
	 * Dispose.
	 */
	public override dispose(): void {
		if (this._positronReactRenderer) {
			this._positronReactRenderer.destroy();
			this._positronReactRenderer = undefined;
		}

		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Protected Overrides

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron console container.
		this._positronConsoleContainer = DOM.$('.positron-console-container');
		this._positronConsoleContainer.setAttribute('user-select', 'all');
		container.appendChild(this._positronConsoleContainer);

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

	//#endregion Protected Overrides

	//#region Public Overrides

	/**
	 * focus override method.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Set the last known height.
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChanged.fire({
			width,
			height
		});
	}

	//#endregion Public Overrides

	//#region Private Methods

	private onDidChangeVisibility(visible: boolean): void {
	}

	//#endregion Private Methods
}

