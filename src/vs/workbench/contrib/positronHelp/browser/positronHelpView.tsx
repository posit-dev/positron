/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { PositronHelp } from 'vs/workbench/contrib/positronHelp/browser/positronHelp';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { ICommandService } from 'vs/platform/commands/common/commands';

export class PositronHelpViewPane extends ViewPane {

	// The PositronReactRenderer.
	positronReactRenderer: PositronReactRenderer | undefined;

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
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
	}

	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Render the Positron top bar component.
		this.positronReactRenderer = new PositronReactRenderer(this.element);
		this.positronReactRenderer.render(
			<PositronHelp
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService} />
		);
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private onDidChangeVisibility(visible: boolean): void {
	}
}

