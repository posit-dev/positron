/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
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
import { PositronMcpActivity } from './positronMcpActivity.js';
import { PositronMcpActivityFeed } from './positronMcpActivityFeed.js';

/** The MCP activity view identifier. */
export const POSITRON_MCP_ACTIVITY_VIEW_ID = 'workbench.panel.positronMcpActivity';

/**
 * The MCP activity view pane: a live feed of what external agents are doing in
 * this Positron session, driven by the main-process server's audit-event
 * stream. The pane is registered only while both `ai.enabled` and
 * `positron.mcp.enable` are set (see the view descriptor's `when` clause).
 */
export class PositronMcpActivityViewPane extends PositronViewPane implements IReactComponentContainer {
	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	private _width = 0;
	private _height = 0;
	private _container!: HTMLElement;
	private _renderer?: PositronReactRenderer;

	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

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
			hoverService);

		this._register(this.onDidChangeBodyVisibility(visible => {
			// See PositronVariablesViewPane: counteract the browser resetting
			// scrollTop on hidden-then-shown children.
			if (!visible) {
				this._onSaveScrollPositionEmitter.fire();
			} else {
				this._onRestoreScrollPositionEmitter.fire();
			}
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._container = DOM.$('.positron-mcp-activity-container');
		container.appendChild(this._container);

		// The feed lives with the rendered body: created here, disposed with the pane.
		const feed = this._register(this.instantiationService.createInstance(PositronMcpActivityFeed));
		this._renderer = this._register(new PositronReactRenderer(this._container));
		this._renderer.render(
			<PositronMcpActivity feed={feed} />
		);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._width = width;
		this._height = height;
		this._onSizeChangedEmitter.fire({ width, height });
	}
}
