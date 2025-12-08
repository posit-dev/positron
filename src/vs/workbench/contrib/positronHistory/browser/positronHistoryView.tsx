/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Emitter } from '../../../../base/common/event.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IExecutionHistoryService } from '../../../services/positronHistory/common/executionHistoryService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { PositronHistoryPanel } from './components/positronHistoryPanel.js';
import { FontConfigurationManager } from '../../../browser/fontConfigurationManager.js';
import { FontInfo } from '../../../../editor/common/config/fontInfo.js';

/**
 * PositronHistoryViewPane class.
 */
export class PositronHistoryViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	// Events
	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	readonly onSizeChanged = this._onSizeChangedEmitter.event;
	readonly onVisibilityChanged = this._onVisibilityChangedEmitter.event;
	readonly onSaveScrollPosition = this._onSaveScrollPositionEmitter.event;
	readonly onRestoreScrollPosition = this._onRestoreScrollPositionEmitter.event;
	readonly onFocused = this._onFocusedEmitter.event;

	// Container and renderer
	private _positronHistoryContainer!: HTMLElement;
	private _positronReactRenderer?: PositronReactRenderer;

	// Font info
	private _fontInfo!: FontInfo;

	// Dimensions
	private _width = 0;
	private _height = 0;

	//#endregion Private Properties

	//#region IReactComponentContainer Implementation

	get width() {
		return this._width;
	}

	get height() {
		return this._height;
	}

	get containerVisible() {
		return this.isBodyVisible();
	}

	takeFocus() {
		this.focus();
	}

	//#endregion IReactComponentContainer Implementation

	//#region Constructor & Dispose

	constructor(
		options: IViewPaneOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService protected override readonly instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IExecutionHistoryService private readonly executionHistoryService: IExecutionHistoryService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly runtimeStartupService: IRuntimeStartupService,
		@IPositronModalDialogsService private readonly positronModalDialogsService: IPositronModalDialogsService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		this._register(this.onDidChangeBodyVisibility(visible => {
			// Save and restore scroll position when visibility changes
			if (!visible) {
				this._onSaveScrollPositionEmitter.fire();
			} else {
				this._onRestoreScrollPositionEmitter.fire();
			}
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	//#endregion Constructor & Dispose

	//#region Protected Overrides

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Create and append the Positron history container
		this._positronHistoryContainer = DOM.$('.positron-history-container');
		container.appendChild(this._positronHistoryContainer);

		// Get the font info for the editor.
		this._fontInfo = FontConfigurationManager.getFontInfo(
			this.configurationService,
			'editor',
			this._positronHistoryContainer
		);

		// Create the PositronReactRenderer for the PositronHistoryPanel component
		this._positronReactRenderer = this._register(
			new PositronReactRenderer(this._positronHistoryContainer)
		);
		this._positronReactRenderer.render(
			<PositronHistoryPanel
				executionHistoryService={this.executionHistoryService}
				fontInfo={this._fontInfo}
				instantiationService={this.instantiationService}
				positronModalDialogsService={this.positronModalDialogsService}
				reactComponentContainer={this}
				runtimeSessionService={this.runtimeSessionService}
				runtimeStartupService={this.runtimeStartupService}
			/>
		);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		// Update dimensions
		this._width = width;
		this._height = height;

		// Fire the size changed event
		this._onSizeChangedEmitter.fire({ width, height });
	}

	//#endregion Protected Overrides

	//#region Public Overrides

	override focus(): void {
		super.focus();
		this._onFocusedEmitter.fire();
	}

	//#endregion Public Overrides
}

