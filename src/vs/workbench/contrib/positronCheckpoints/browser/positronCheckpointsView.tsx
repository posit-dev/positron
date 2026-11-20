/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
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
import { CheckpointsPanel } from './components/checkpointsPanel.js';

/**
 * The Checkpoints view pane. It mounts `CheckpointsPanel` with a `PositronReactRenderer`.
 */
export class PositronCheckpointsView extends PositronViewPane implements IReactComponentContainer {
	private readonly _onSizeChanged = this._register(new Emitter<ISize>());
	private readonly _onVisibilityChanged = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPosition = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPosition = this._register(new Emitter<void>());
	private readonly _onFocused = this._register(new Emitter<void>());

	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPosition.event;
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPosition.event;
	readonly onFocused: Event<void> = this._onFocused.event;

	private _width = 0;
	private _height = 0;

	get width(): number {
		return this._width;
	}

	get height(): number {
		return this._height;
	}

	get containerVisible(): boolean {
		return this.isBodyVisible();
	}

	takeFocus(): void {
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
			hoverService
		);

		this._register(this.onDidChangeBodyVisibility(visible => {
			// The browser resets the scroll position of hidden content, so the React content saves
			// it when the body is hidden and restores it when the body is shown again.
			if (!visible) {
				this._onSaveScrollPosition.fire();
			} else {
				this._onRestoreScrollPosition.fire();
			}
			this._onVisibilityChanged.fire(visible);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const panelContainer = DOM.$('.positron-checkpoints-container');
		container.appendChild(panelContainer);

		const renderer = this._register(new PositronReactRenderer(panelContainer));
		renderer.render(<CheckpointsPanel container={this} />);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = width;
		this._height = height;
		this._onSizeChanged.fire({ width, height });
	}
}
