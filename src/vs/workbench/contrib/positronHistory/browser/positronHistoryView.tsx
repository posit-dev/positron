/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { TestContent } from './components/testContent.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';

/**
 * PositronHistoryViewPane class.
 */
export class PositronHistoryViewPane extends ViewPane {
	//#region Private Properties

	// The PositronReactRenderer.
	private positronReactRenderer?: PositronReactRenderer;

	private _sessionMetadata: IPositronSessionMetadata | undefined;

	//#endregion Private Properties

	//#region Constructor & Dispose

	constructor(
		options: IViewPaneOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IPositronSessionService private readonly _positronSessionService: IPositronSessionService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
	}

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

		if (this._sessionMetadata) {
			this.renderMeta(this._sessionMetadata);
		} else {
			this._positronSessionService.getSessionMetadata().then(metadata => {
				this._sessionMetadata = metadata;
				this.renderMeta(metadata);
			});
		}
	}

	private renderMeta(metadata: IPositronSessionMetadata): void {
		const testContent = `History React - Session: ${metadata.ordinal} (${metadata.created})`;

		// Render the component.
		this.positronReactRenderer = new PositronReactRenderer(this.element);
		this.positronReactRenderer.render(
			<TestContent message={testContent} />
		);
	}

	//#endregion Protected Overrides

	//#region Public Overrides

	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	//#endregion Public Overrides

	//#region Private Methods

	private onDidChangeVisibility(visible: boolean): void {
	}

	//#endregion Private Methods
}

