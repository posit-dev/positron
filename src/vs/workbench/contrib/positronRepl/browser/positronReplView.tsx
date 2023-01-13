/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
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
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { TestContent } from 'vs/workbench/contrib/positronRepl/browser/components/testContent';

/**
 * PositronReplViewPane class.
 */
export class PositronReplViewPane extends ViewPane {
	//#region Private Properties

	// The PositronReactRenderer.
	private positronReactRenderer: PositronReactRenderer | undefined;

	//#endregion Private Properties

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
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
	}

	/**
	 * Dispose.
	 */
	public override dispose(): void {
		if (this.positronReactRenderer) {
			this.positronReactRenderer.destroy();
			this.positronReactRenderer = undefined;
		}

		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Protected Overrides

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Render the Positron top action bar component.
		this.positronReactRenderer = new PositronReactRenderer(this.element);
		this.positronReactRenderer.render(
			<TestContent message='Console Preview' />
		);
	}

	//#endregion Protected Overrides

	//#region Public Overrides

	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	//#endregion Public Overrides

	//#region Private Methods

	private onDidChangeVisibility(visible: boolean): void {
	}

	//#endregion Private Methods
}

