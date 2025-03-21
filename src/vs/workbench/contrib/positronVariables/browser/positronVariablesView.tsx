/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronVariablesView.css';

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { PositronVariablesFocused } from '../../../common/contextkeys.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { PositronVariables } from './positronVariables.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

/**
 * PositronVariablesViewPane class.
 */
export class PositronVariablesViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	/**
	 * The onSizeChanged event emitter.
	 */
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	/**
	 * The onSaveScrollPosition event emitter.
	 */
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onRestoreScrollPosition event emitter.
	 */
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused event emitter.
	 */
	private _onFocusedEmitter = this._register(new Emitter<void>());

	/**
	 * Gets or sets the width. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _width = 0;

	/**
	 * Gets or sets the height. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _height = 0;

	/**
	 * Gets or sets the Positron variables container. Contains the entire Positron variables UI.
	 */
	private _positronVariablesContainer!: HTMLElement;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronVariables component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Gets or sets the PositronVariablesFocused context key.
	 */
	private _positronVariablesFocusedContextKey: IContextKey<boolean> | undefined;

	//#endregion Private Properties

	//#region IReactComponentContainer

	/**
	 * Gets the width.
	 */
	get width() {
		return this._width;
	}

	/**
	 * Gets the height.
	 */
	get height() {
		return this._height;
	}

	/**
	 * Gets the container visibility.
	 */
	get containerVisible() {
		return this.isBodyVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus() {
		this.focus();
	}

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged(focused: boolean) {
		this._positronVariablesFocusedContextKey?.set(focused);
		if (focused) {
			this._onFocusedEmitter.fire();
		}
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	/**
	 * The onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

	/**
	 * The onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;

	/**
	 * The onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;

	/**
	 * The onFocused event.
	 */
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	//#endregion IReactComponentContainer

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param options The IViewPaneOptions for the view pane.
	 * @param _accessibilityService The accessibility service.
	 * @param clipboardService The clipboard service.
	 * @param _commandService The command service.
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param _dataExplorerService The data explorer service.
	 * @param hoverService The hover service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param _languageRuntimeService The language runtime service.
	 * @param _runtimeSessionService The runtime session service.
	 * @param openerService The opener service.
	 * @param _positronVariablesService The Positron variables service.
	 * @param telemetryService The ITelemetryService.
	 * @param themeService The IThemeService.
	 * @param viewDescriptorService The IViewDescriptorService.
	 * @param _layoutService The layout service.
	 */
	constructor(
		options: IViewPaneOptions,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IPositronDataExplorerService private readonly _dataExplorerService: IPositronDataExplorerService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IOpenerService openerService: IOpenerService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@INotificationService private readonly _notificationService: INotificationService
	) {
		// Call the base class's constructor.
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

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			// The browser will automatically set scrollTop to 0 on child components that have been
			// hidden and made visible. (This is called "desperate" elsewhere in Visual Studio Code.
			// Search for that word and you'll see other examples of hacks that have been added to
			// to fix this problem.) IReactComponentContainers can counteract this behavior by
			// firing onSaveScrollPosition and onRestoreScrollPosition events to have their child
			// components save and restore their scroll positions.
			if (!visible) {
				this._onSaveScrollPositionEmitter.fire();
			} else {
				this._onRestoreScrollPositionEmitter.fire();
			}
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	//#endregion Constructor & Dispose

	//#region Overrides

	/**
	 * renderBody override method.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Create and append the Positron variables container.
		this._positronVariablesContainer = DOM.$('.positron-variables-container');
		container.appendChild(this._positronVariablesContainer);

		// Create the scoped context key service for the Positron variables container.
		const scopedContextKeyService = this._register(this.contextKeyService.createScoped(
			this._positronVariablesContainer
		));

		// Create the PositronVariablesFocused context key.
		this._positronVariablesFocusedContextKey = PositronVariablesFocused.bindTo(
			scopedContextKeyService
		);

		// Create the PositronReactRenderer for the PositronVariables component and render it.
		this._positronReactRenderer = new PositronReactRenderer(this._positronVariablesContainer);
		this._register(this._positronReactRenderer);
		this._positronReactRenderer.render(
			<PositronVariables
				accessibilityService={this._accessibilityService}
				clipboardService={this.clipboardService}
				commandService={this._commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				dataExplorerService={this._dataExplorerService}
				hoverService={this.hoverService}
				keybindingService={this.keybindingService}
				languageRuntimeService={this._languageRuntimeService}
				layoutService={this._layoutService}
				notificationService={this._notificationService}
				positronVariablesService={this._positronVariablesService}
				reactComponentContainer={this}
				runtimeSessionService={this._runtimeSessionService}
			/>
		);
	}

	/**
	 * Drive focus to inner element.
	 * Called by `super.focus()`.
	 */
	override focusElement(): void {
		// Trigger event that eventually causes variable pane widgets to focus
		this._positronVariablesService.activePositronVariablesInstance?.focusElement();
	}

	/**
	 * layoutBody override method.
	 * @param height The height of the body.
	 * @param width The width of the body.
	 */
	protected override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChangedEmitter.fire({
			width,
			height
		});
	}

	//#endregion Overrides
}
