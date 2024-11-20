/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IReactComponentContainer,
	ISize,
	PositronReactRenderer,
} from 'vs/base/browser/positronReactRenderer';
import { Emitter, Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { PositronViewPane } from 'vs/workbench/browser/positronViewPane/positronViewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import * as DOM from 'vs/base/browser/dom';
import { PositronConnections } from 'vs/workbench/contrib/positronConnections/browser/positronConnections';
import * as React from 'react';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

export class PositronConnectionsView
	extends PositronViewPane
	implements IReactComponentContainer {

	private onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private onFocusedEmitter = this._register(new Emitter<void>());

	private positronConnectionsContainer!: HTMLElement;
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
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
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
		@ICommandService private readonly commandService: ICommandService,
		@IPositronConnectionsService private readonly connectionsService: IPositronConnectionsService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService
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
			telemetryService,
			hoverService
		);

		this._register(this.onDidChangeBodyVisibility(visible => {
			// The browser will automatically set scrollTop to 0 on child components that have been
			// hidden and made visible. (This is called "desperate" elsewhere in Visual Studio Code.
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
		}));
	}

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Create and append the Positron variables container.
		this.positronConnectionsContainer = DOM.$('.positron-connections-container');
		container.appendChild(this.positronConnectionsContainer);


		// Create the PositronReactRenderer for the PositronVariables component and render it.
		this.positronReactRenderer = new PositronReactRenderer(this.positronConnectionsContainer);
		this._register(this.positronReactRenderer);
		this.positronReactRenderer.render(
			<PositronConnections
				accessibilityService={this.accessibilityService}
				configurationService={this.configurationService}
				commandService={this.commandService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				hoverService={this.hoverService}
				keybindingService={this.keybindingService}
				connectionsService={this.connectionsService}
				layoutService={this.layoutService}
				reactComponentContainer={this}
				clipboardService={this.clipboardService}
				notificationService={this.notificationService}
				editorService={this.editorService}
			/>
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
			height
		});
	}
}
