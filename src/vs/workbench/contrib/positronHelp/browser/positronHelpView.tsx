/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
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
import { PositronHelpActionBars } from 'vs/workbench/contrib/positronHelp/browser/positronHelpActionBars';
import { IHelpResult, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';

/**
 * PositronHelpViewPane class.
 */
export class PositronHelpViewPane extends ViewPane implements IReactComponentContainer {

	// The PositronReactRenderer.
	positronReactRenderer: PositronReactRenderer | undefined;

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	// The help container - contains the entire help UI.
	private _helpContainer!: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private _helpActionBarsContainer!: HTMLElement;

	// The help content that is currently being renderd.
	private _helpContent!: HTMLElement;

	private _helpResult!: IHelpResult;

	// Constructor.
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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));

		this._register(this.positronHelpService.onRenderHelp(e => {
			console.log('PositronHelpViewPane got onRenderHelp');
			console.log(e);
			if (this._helpResult) {
				this._helpResult.element.remove();
				this._helpResult.dispose();
			}
			this._helpResult = e;
			this._helpContent.appendChild(this._helpResult.element);
		}));
	}

	public override dispose(): void {
		if (this.positronReactRenderer) {
			this.positronReactRenderer.destroy();
			this.positronReactRenderer = undefined;
		}

		super.dispose();
	}

	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	protected override renderBody(parent: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(parent);

		// Append the help container.
		this._helpContainer = DOM.$('.positron-help-container');
		parent.appendChild(this._helpContainer);

		// Append the help action bars container.
		this._helpActionBarsContainer = DOM.$('.positron-help-action-bars-container');
		this._helpContainer.appendChild(this._helpActionBarsContainer);

		// Render the Positron help action bars component.
		this.positronReactRenderer = new PositronReactRenderer(this._helpActionBarsContainer);
		this.positronReactRenderer.render(
			<PositronHelpActionBars
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				positronHelpService={this.positronHelpService}
				reactComponentContainer={this} />
		);

		// Append the help content.
		this._helpContent = DOM.$('.positron-help-content');
		this._helpContainer.appendChild(this._helpContent);
	}

	override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Raise the onSizeChanged event.
		this._onSizeChanged.fire({
			width,
			height
		});
	}

	private onDidChangeVisibility(visible: boolean): void {
		// Raise the onVisibilityChanged event.
		this._onVisibilityChanged.fire(visible);
	}
}
