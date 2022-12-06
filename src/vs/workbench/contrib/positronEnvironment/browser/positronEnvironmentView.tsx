/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { PositronEnvironment } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironment';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';

/**
 * PositronEnvironmentViewPane class.
 */
export class PositronEnvironmentViewPane extends ViewPane implements IReactComponentContainer {

	// The PositronReactRenderer.
	private _positronReactRenderer: PositronReactRenderer | undefined;

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	// The environment container - contains the entire environment UI.
	//private _environmentContainer!: HTMLElement;

	// The environment action bars container - contains the PositronEnvironmentActionBars component.
	//private _environmentActionBarsContainer!: HTMLElement;

	// Constructor.
	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		// Call the base class's constructor.
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		// Register event handlers.
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
	}

	// Dispose method.
	public override dispose(): void {
		// Destroy the PositronReactRenderer.
		if (this._positronReactRenderer) {
			this._positronReactRenderer.destroy();
			this._positronReactRenderer = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	// Focus override.
	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	// Render body override.
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Render the Positron top action bar component.
		this._positronReactRenderer = new PositronReactRenderer(this.element);
		this._positronReactRenderer.render(
			<PositronEnvironment />
		);
	}

	// Layout body override.
	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private onDidChangeVisibility(visible: boolean): void {
	}
}

