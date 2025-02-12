/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IElementPosition, IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { Event, Emitter } from '../../../../base/common/event.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IPositronPreviewService } from './positronPreviewSevice.js';
import { PositronPreview } from './positronPreview.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { PositronViewPane } from '../../../browser/positronViewPane/positronViewPane.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

/**
 * PositronPreviewViewPane class.
 */
export class PositronPreviewViewPane extends PositronViewPane implements IReactComponentContainer {
	//#region Private Properties

	// The PositronReactRenderer.
	private _positronReactRenderer?: PositronReactRenderer;

	// The Positron preview container - contains the entire Positron preview UI.
	private _positronPreviewContainer: HTMLElement;

	// The onSizeChanged emitter.
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	// The onPositionChanged emitter.
	private _onPositionChangedEmitter = this._register(new Emitter<IElementPosition>());

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

	// The timeout for the position-based redraw.
	private _redrawTimeout: NodeJS.Timeout | undefined;

	//#endregion Private Properties

	//#region Constructor & Dispose

	constructor(
		options: IViewPaneOptions,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IPositronPreviewService private readonly positronPreviewService: IPositronPreviewService,
		@IHoverService hoverService: IHoverService,
	) {
		super({ ...options, openFromCollapsedSize: '50%' }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService, hoverService);

		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));
		this._positronPreviewContainer = DOM.$('.positron-preview-container');
	}

	public override dispose(): void {
		super.dispose();
	}

	//#endregion Constructor & Dispose

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
	//#region Protected Overrides

	protected override renderBody(container: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(container);

		// Append the Positron preview container.
		container.appendChild(this._positronPreviewContainer);

		// Create the PositronReactRenderer for the PositronPreview component and render it.
		this._positronReactRenderer = new PositronReactRenderer(this._positronPreviewContainer);
		this._register(this._positronReactRenderer);
		this._positronReactRenderer.render(
			<PositronPreview
				accessibilityService={this.accessibilityService}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				hoverService={this.hoverService}
				keybindingService={this.keybindingService}
				layoutService={this.layoutService}
				notificationService={this.notificationService}
				openerService={this.openerService}
				positronPreviewService={this.positronPreviewService}
				reactComponentContainer={this}
				runtimeSessionService={this.runtimeSessionService} />
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

		// Set the width and height.
		this._width = width;
		this._height = height;

		// Raise the onSizeChanged event.
		this._onSizeChangedEmitter.fire({
			width,
			height
		});

		// Get the window object associated with the preview container
		const window = DOM.getWindow(this._positronPreviewContainer);

		// Cancel any in-progress redraw.
		if (this._redrawTimeout) {
			clearTimeout(this._redrawTimeout);
			this._redrawTimeout = undefined;
		}

		// Compute the physical position of the preview container. We do this so
		// that we can trigger a render of the preview container if the position
		// has changed, which moves the OverlayWebView to the correct position.
		// This is necessary because the OverlayWebView is not a child of the
		// preview container (it is, by necessity, absolutely positioned above
		// it), so it does not move with the preview container.
		//
		// This position can change without `layoutBody` being called, since
		// during the panel reveal animation the panel slides its body element
		// into view. To accomodate this, we repeatedly query the position of
		// the preview container until it stops changing.
		//
		// Measure the initial position of the preview container.
		let boundingRect = this._positronPreviewContainer.getBoundingClientRect();

		// This function is called repeatedly until the position of the preview
		// container stops changing.
		const redraw = () => {
			// Measure the new position of the preview container.
			const newBoundingRect = this._positronPreviewContainer.getBoundingClientRect();

			// If the position has changed, raise the onPositionChanged event. This triggers the
			// webview to reposition itself if the position has changed.
			this._onPositionChangedEmitter.fire({
				x: newBoundingRect.x,
				y: newBoundingRect.y,
			});

			if (boundingRect.x !== newBoundingRect.x || boundingRect.y !== newBoundingRect.y) {
				boundingRect = newBoundingRect;
				// If the position changed since the last time we measured it,
				// schedule another redraw.
				this._redrawTimeout = setTimeout(() => window.requestAnimationFrame(redraw), 100);
			}
		};

		// Perform the first redraw.
		redraw();

		// Check again in 100ms to see if the position has changed.
		this._redrawTimeout = setTimeout(() => window.requestAnimationFrame(redraw), 100);
	}

	//#endregion Public Overrides

	//#region Private Methods

	private onDidChangeVisibility(visible: boolean): void {
		this._onVisibilityChangedEmitter.fire(visible);
	}

	//#endregion Private Methods
}

