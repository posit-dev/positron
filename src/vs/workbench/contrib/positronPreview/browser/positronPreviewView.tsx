/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IElementPosition, IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { Event, Emitter } from 'vs/base/common/event';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PositronPreview } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';

/**
 * PositronPreviewViewPane class.
 */
export class PositronPreviewViewPane extends ViewPane implements IReactComponentContainer {
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

	// Whether a position-based redraw is pending.
	private _redrawPending = false;

	//#endregion Private Properties

	//#region Constructor & Dispose

	constructor(
		options: IViewPaneOptions,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IPositronPreviewService private readonly positronPreviewService: IPositronPreviewService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
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
	 * Gets the visible state.
	 */
	get visible() {
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
				commandService={this.commandService}
				layoutService={this.layoutService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				positronPreviewService={this.positronPreviewService}
				reactComponentContainer={this} />
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

		// If a position-based redraw is pending, no need to do anything else;
		// we will compute the new position of the element when it completes.
		if (this._redrawPending) {
			return;
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

		// Ensure this isn't re-entrant (we don't want multiple pending redraws in flight)
		this._redrawPending = true;

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
				setTimeout(() => window.requestAnimationFrame(redraw), 100);
			} else {
				// This position hasn't changed since the last time we measured; we can stop
				// redrawing now.
				this._redrawPending = false;
			}
		};

		// Schedule the first redraw.
		setTimeout(() => window.requestAnimationFrame(redraw), 100);
	}

	//#endregion Public Overrides

	//#region Private Methods

	private onDidChangeVisibility(visible: boolean): void {
		this._onVisibilityChangedEmitter.fire(visible);
	}

	//#endregion Private Methods
}

