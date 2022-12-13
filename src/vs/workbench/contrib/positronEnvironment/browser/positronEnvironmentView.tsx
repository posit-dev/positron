/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronEnvironmentView';
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
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/positronEnvironment';
import { PositronEnvironmentData } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentData';
import { PositronEnvironmentActionBars } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentActionBars';

/**
 * PositronEnvironmentViewPane class.
 */
export class PositronEnvironmentViewPane extends ViewPane implements IReactComponentContainer {

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	private _width: number;
	private _height: number;

	// The Positron environment container - contains the entire Positron environment UI.
	private _positronEnvironmentContainer!: HTMLElement;

	// The environment action bars container - contains the PositronEnvironmentActionBars component.
	private _environmentActionBarsContainer!: HTMLElement;

	// The environment data container - contains the PositronEnvironmentData component.
	private _environmentDataContainer!: HTMLElement;

	// The PositronReactRenderer for the PositronEnvironmentActionBars component.
	private _positronReactRendererEnvironmentActionBars: PositronReactRenderer | undefined;

	// The PositronReactRenderer for the PositronEnvironmentData component.
	private _positronReactRendererEnvironmentData: PositronReactRenderer | undefined;

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
	 * @param positronEnvironmentService The IPositronEnvironmentService.
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
		@IPositronEnvironmentService positronEnvironmentService: IPositronEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		// Call the base class's constructor.
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this._width = 0;
		this._height = 0;

		// Register event handlers.
		this._register(this.onDidChangeBodyVisibility(() => this._onVisibilityChanged.fire(this.isBodyVisible())));
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Destroy the PositronReactRenderer for the PositronEnvironmentActionBars component.
		if (this._positronReactRendererEnvironmentActionBars) {
			this._positronReactRendererEnvironmentActionBars.destroy();
			this._positronReactRendererEnvironmentActionBars = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	/**
	 * focus override method.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	/**
	 * renderBody override method.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron environment container.
		this._positronEnvironmentContainer = DOM.$('.positron-environment-container');
		container.appendChild(this._positronEnvironmentContainer);

		// Append the environment action bars container.
		this._environmentActionBarsContainer = DOM.$('.environment-action-bars-container');
		this._positronEnvironmentContainer.appendChild(this._environmentActionBarsContainer);

		// Append the environment container.
		this._environmentDataContainer = DOM.$('.environment-data-container');
		this._positronEnvironmentContainer.appendChild(this._environmentDataContainer);

		// Filter handler.
		const filterHandler = (findText: string) => {
		};

		console.log(`PositronEnvironmentViewPane.renderBody called ${this._width},${this._height}`);

		// Render the PositronEnvironmentActionBars component.
		this._positronReactRendererEnvironmentActionBars = new PositronReactRenderer(this._environmentActionBarsContainer);
		this._positronReactRendererEnvironmentActionBars.render(
			<PositronEnvironmentActionBars
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				reactComponentContainer={this}
				onLoadWorkspace={() => console.log('Load workspace made it to the Positron environment view.')}
				onSaveWorkspaceAs={() => console.log('Save workspace as made it to the Positron environment view.')}
				onFilter={filterHandler}
				onCancelFilter={() => filterHandler('')}
			/>
		);

		// Render the PositronEnvironmentData component.
		this._positronReactRendererEnvironmentData = new PositronReactRenderer(this._environmentDataContainer);
		this._positronReactRendererEnvironmentData.render(
			<PositronEnvironmentData
				initialHeight={() => this._height - 64}
				reactComponentContainer={this} />
		);
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	override layoutBody(height: number, width: number): void {
		console.log(`+++++++PositronEnvironmentViewPane - layoutBody called ${width},${height}`);
		// Call the base class's method.
		super.layoutBody(height, width);

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChanged.fire({
			width,
			height
		});
	}
}

