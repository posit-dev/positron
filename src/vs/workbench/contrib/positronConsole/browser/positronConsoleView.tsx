/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronConsoleView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
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
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IReplService } from 'vs/workbench/contrib/repl/browser/repl';

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
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param openerService The opener service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 * @param viewDescriptorService The view descriptor service.
	 */
	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@IOpenerService openerService: IOpenerService,
		@IReplService private readonly _replService: IReplService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
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
		container.appendChild(this._positronConsoleContainer);

		// Render the Positron console.
		this._positronReactRenderer = new PositronReactRenderer(this._positronConsoleContainer);
		this._positronReactRenderer.render(
			<PositronConsole
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				languageRuntimeService={this.languageRuntimeService}
				layoutService={this.layoutService}
				reactComponentContainer={this}
				replService={this._replService}
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

