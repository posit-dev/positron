/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataView.css';

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
import { PositronData } from './positronData.js';

/**
 * PositronDataViewPane class.
 */
export class PositronDataViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

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

	private _positronDataContainer!: HTMLElement;
	private _positronReactRenderer?: PositronReactRenderer;

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

	/**
	 * Constructor.
	 */
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
		super.renderBody(container);

		// Create and append the Positron data container.
		this._positronDataContainer = DOM.$('.positron-data-container');
		container.appendChild(this._positronDataContainer);

		// Create the PositronReactRenderer for the PositronData component.
		this._positronReactRenderer = this._register(
			new PositronReactRenderer(this._positronDataContainer)
		);
		this._positronReactRenderer.render(
			<PositronData reactComponentContainer={this} />
		);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		// Update dimensions.
		this._width = width;
		this._height = height;

		// Fire the size changed event.
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
