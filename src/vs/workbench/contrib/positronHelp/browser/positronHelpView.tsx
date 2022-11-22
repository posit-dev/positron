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
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { PositronHelp } from 'vs/workbench/contrib/positronHelp/browser/positronHelp';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IHelpResult, IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';

export class PositronHelpViewPane extends ViewPane implements IReactComponentContainer {

	// The PositronReactRenderer.
	positronReactRenderer: PositronReactRenderer | undefined;

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	private _helpContainer!: HTMLElement;

	private _helpResult!: IHelpResult;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IPositronHelpService private readonly positronHelpService: IPositronHelpService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));

		this._register(positronHelpService.onRenderHelp(e => {
			console.log('PositronHelpViewPane got onRenderHelp');
			console.log(e);
			if (this._helpResult) {
				this._helpResult.element.remove();
				this._helpResult.dispose();
			}
			this._helpResult = e;
			this._helpContainer.appendChild(this._helpResult.element);
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
		super.renderBody(parent);

		const contentContainer = document.createElement('div');
		contentContainer.className = 'content';
		parent.appendChild(contentContainer);


		// Render the Positron top action bar component.
		this.positronReactRenderer = new PositronReactRenderer(contentContainer);
		this.positronReactRenderer.render(
			<PositronHelp
				reactComponentContainer={this}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				positronHelpService={this.positronHelpService} />
		);

		// const dd = document.createElement('iframe');

		this._helpContainer = document.createElement('div');
		this._helpContainer.className = 'content';
		this._helpContainer.style.background = 'red';
		parent.appendChild(this._helpContainer);
	}

	override layoutBody(height: number, width: number): void {
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
