/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronPlotsView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronPlots } from 'vs/workbench/contrib/positronPlots/browser/positronPlots';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IElementPosition, IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { PositronViewPane } from 'vs/workbench/browser/positronViewPane/positronViewPane';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';

/**
 * PositronPlotsViewPane class.
 */
export class PositronPlotsViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The onSizeChanged emitter.
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	// The onPositionChanged emitter.
	private _onPositionChangedEmitter = this._register(new Emitter<IElementPosition>);

	// The onVisibilityChanged event emitter.
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	// The onSaveScrollPosition emitter.
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	// The onRestoreScrollPosition emitter.
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	// The onFocused emitter.
	private _onFocusedEmitter = this._register(new Emitter<void>());

	// The width. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _width = 0;

	// The height. This value is set in layoutBody and is used to implement the
	// IReactComponentContainer interface.
	private _height = 0;

	// The Positron plots container - contains the entire Positron plots UI.
	private _positronPlotsContainer!: HTMLElement;

	// The ResizeObserver for the Positron plots container.
	private _positronPlotsContainerResizeObserver?: ResizeObserver;

	// The PositronReactRenderer for the PositronPlots component.
	private _positronReactRenderer?: PositronReactRenderer;

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
	takeFocus(): void {
		this.focus();
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

	/**
	 * The onPositionChanged event.
	 */
	readonly onPositionChanged: Event<IElementPosition> = this._onPositionChangedEmitter.event;

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
	 * @param options The options for the view pane.
	 * @param accessibilityService The accessibility service.
	 * @param commandService The command service.
	 * @param configurationService The configuration service.
	 * @param contextKeyService The context key service.
	 * @param contextMenuService The context menu service.
	 * @param hoverService The hover service.
	 * @param instantiationService The instantiation service.
	 * @param keybindingService The keybinding service.
	 * @param languageRuntimeService The language runtime service.
	 * @param notificationService The notification service.
	 * @param openerService The opener service.
	 * @param positronPlotsService The oositron plots service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 * @param viewDescriptorService The view descriptor service.
	 * @param layoutService The layout service.
	 * @param workbenchLayoutService The workbench layout service.
	 */
	constructor(
		options: IViewPaneOptions,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IHoverService hoverService: IHoverService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ILanguageRuntimeService private readonly languageRuntimeService: ILanguageRuntimeService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@IPositronPlotsService private readonly positronPlotsService: IPositronPlotsService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		// Call the base class's constructor.
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		// Register the onDidChangeBodyVisibility event handler.
		this._register(this.onDidChangeBodyVisibility(visible => {
			this._onVisibilityChangedEmitter.fire(visible);
		}));
	}

	/**
	 * Dispose method.
	 */
	public override dispose(): void {
		// Disconnect the ResizeObserver for the Positron plots container.
		this._positronPlotsContainerResizeObserver?.disconnect();

		// Call the base class's dispose method.
		super.dispose();
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

		// Append the Positron plots container.
		this._positronPlotsContainer = DOM.$('.positron-plots-container');
		container.appendChild(this._positronPlotsContainer);

		// Observe the plots container for resizes and fire size/position changed events.
		// This is needed in addition to the layoutBody override to trigger React renders
		// when either the plots pane or a neighboring pane is expanded/collapsed,
		// since the expand/collapse transition may be animated. Otherwise, the size/position
		// changed events would only fire at the beginning of the animation possibly leading
		// to incorrect layouts.
		this._positronPlotsContainerResizeObserver?.disconnect();
		this._positronPlotsContainerResizeObserver = new ResizeObserver(entries => {
			for (const entry of entries) {
				if (entry.target === this._positronPlotsContainer) {
					this._onSizeChangedEmitter.fire({
						width: entry.contentRect.width,
						height: entry.contentRect.height
					});
					this._onPositionChangedEmitter.fire({
						x: entry.contentRect.x,
						y: entry.contentRect.y
					});
				}
			}
		});
		this._positronPlotsContainerResizeObserver.observe(this._positronPlotsContainer);

		// Create the PositronReactRenderer for the PositronPlots component and render it.
		this._positronReactRenderer = this._register(new PositronReactRenderer(this._positronPlotsContainer));
		this._positronReactRenderer.render(
			<PositronPlots
				accessibilityService={this.accessibilityService}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				hoverService={this.hoverService}
				keybindingService={this.keybindingService}
				languageRuntimeService={this.languageRuntimeService}
				layoutService={this.layoutService}
				positronPlotsService={this.positronPlotsService}
				notificationService={this.notificationService}
				reactComponentContainer={this} />
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

		// Raise the onPositionChanged event.
		const bounding = this._positronPlotsContainer.getBoundingClientRect();
		this._onPositionChangedEmitter.fire({
			x: bounding.x,
			y: bounding.y
		});
	}

	//#endregion Overrides
}
