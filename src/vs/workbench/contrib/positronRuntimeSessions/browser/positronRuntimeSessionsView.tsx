/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronRuntimeSessionsView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { PositronSessions } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessions';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';

/**
 * PositronSessionsViewPane class.
 */
export class PositronRuntimeSessionsViewPane extends ViewPane implements IReactComponentContainer {
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
	private _positronSessionsContainer!: HTMLElement;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronSessions component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Gets or sets the PositronSessionsFocused context key.
	 */
	private _positronSessionsFocusedContextKey: IContextKey<boolean> | undefined;

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
		this._positronSessionsFocusedContextKey?.set(focused);
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
	 * @param _commandService The command service.
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _runtimeSessionService The runtime session service.
	 * @param openerService The opener service.
	 * @param _positronSessionsService The Positron variables service.
	 * @param telemetryService The ITelemetryService.
	 * @param themeService The IThemeService.
	 * @param viewDescriptorService The IViewDescriptorService.
	 * @param _layoutService The layout service.
	 */
	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IWorkbenchLayoutService private readonly _layoutService: IWorkbenchLayoutService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
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
			telemetryService);

		// Register the onDidChangeBodyVisibility event handler.
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

	//#region Overrides

	/**
	 * renderBody override method.
	 * @param container The container HTMLElement.
	 */
	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Create and append the Positron variables container.
		this._positronSessionsContainer = DOM.$('.positron-sessions-container');
		container.appendChild(this._positronSessionsContainer);

		// Create the PositronReactRenderer for the PositronSessions component and render it.
		this._positronReactRenderer = new PositronReactRenderer(this._positronSessionsContainer);
		this._register(this._positronReactRenderer);
		this._positronReactRenderer.render(
			<PositronSessions
				commandService={this._commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				layoutService={this._layoutService}
				runtimeSessionService={this._runtimeSessionService}
				reactComponentContainer={this}
			/>
		);
	}

	/**
	 * focus override method.
	 */
	override focus(): void {
		// Call the base class's method.
		super.focus();

		// Fire the onFocused event.
		this._onFocusedEmitter.fire();
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
