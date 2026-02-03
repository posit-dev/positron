/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronPackagesView.css';

import {
	IReactComponentContainer,
	ISize,
	PositronReactRenderer,
} from '../../../../base/browser/positronReactRenderer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IViewDescriptorService } from '../../../common/views.js';
import * as DOM from '../../../../base/browser/dom.js';
import { PositronPackages } from './positronPackages.js';
import * as React from 'react';

export class PositronPackagesView
	extends PositronViewPane
	implements IReactComponentContainer {
	private onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private onFocusedEmitter = this._register(new Emitter<void>());

	private positronPackagesContainer!: HTMLElement;
	private positronReactRenderer?: PositronReactRenderer;

	onFocused: Event<void> = this.onFocusedEmitter.event;
	onSizeChanged: Event<ISize> = this.onSizeChangedEmitter.event;
	onVisibilityChanged: Event<boolean> = this.onVisibilityChangedEmitter.event;
	onSaveScrollPosition: Event<void> = this.onSaveScrollPositionEmitter.event;
	onRestoreScrollPosition: Event<void> =
		this.onRestoreScrollPositionEmitter.event;

	private _width = 0;
	private _height = 0;

	get height() {
		return this._height;
	}

	get width() {
		return this._width;
	}

	get containerVisible() {
		return false;
	}

	takeFocus() {
		this.focus();
	}

	constructor(
		options: IViewPaneOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
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
			hoverService,
		);

		this._register(
			this.onDidChangeBodyVisibility((visible) => {
				// The browser will automatically set scrollTop to 0 on child components that have been
				// hidden and made visible. (This is called 'desperate' elsewhere in Visual Studio Code.
				// Search for that word and you'll see other examples of hacks that have been added to
				// to fix this problem.) IReactComponentContainers can counteract this behavior by
				// firing onSaveScrollPosition and onRestoreScrollPosition events to have their child
				// components save and restore their scroll positions.
				if (!visible) {
					this.onSaveScrollPositionEmitter.fire();
				} else {
					this.onRestoreScrollPositionEmitter.fire();
				}
				this.onVisibilityChangedEmitter.fire(visible);
			}),
		);
	}

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Create and append the Positron packages container.
		this.positronPackagesContainer = DOM.$('.positron-packages-container');
		container.appendChild(this.positronPackagesContainer);

		// Create the PositronReactRenderer for the PositronPackages component and render it.
		this.positronReactRenderer = this._register(
			new PositronReactRenderer(this.positronPackagesContainer),
		);
		this.positronReactRenderer.render(
			<PositronPackages reactComponentContainer={this} />,
		);
	}

	protected override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this.onSizeChangedEmitter.fire({
			width,
			height,
		});
	}
}
