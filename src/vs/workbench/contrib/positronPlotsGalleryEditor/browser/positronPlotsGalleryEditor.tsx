/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IReactComponentContainer, ISize, IElementPosition, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { PositronPlotsGalleryEditorInput } from './positronPlotsGalleryEditorInput.js';
import { PositronPlots } from '../../positronPlots/browser/positronPlots.js';
import { IPositronPlotsService, PlotsDisplayLocation } from '../../../services/positronPlots/common/positronPlots.js';

/**
 * PositronPlotsGalleryEditor class.
 * This editor displays the full Positron plots gallery (thumbnails, navigation, controls)
 * and can be opened in the main window or in an auxiliary window.
 */
export class PositronPlotsGalleryEditor extends EditorPane implements IReactComponentContainer {
	//#region Private Properties

	// The main container element
	private readonly _container: HTMLElement;

	// The React renderer
	private _reactRenderer?: PositronReactRenderer;

	// The width and height
	private _width = 0;
	private _height = 0;

	// Event emitters for the IReactComponentContainer interface
	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());
	private readonly _onPositionChangedEmitter = this._register(new Emitter<IElementPosition>());
	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());
	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());
	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	//#endregion Private Properties

	//#region IReactComponentContainer Implementation

	get width() {
		return this._width;
	}

	get height() {
		return this._height;
	}

	get containerVisible() {
		return this.isVisible();
	}

	takeFocus(): void {
		this.focus();
	}

	readonly onSizeChanged = this._onSizeChangedEmitter.event;
	readonly onPositionChanged = this._onPositionChangedEmitter.event;
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;
	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;
	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;
	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	//#endregion IReactComponentContainer Implementation

	//#region Constructor

	constructor(
		readonly _group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService,
	) {
		super(
			PositronPlotsGalleryEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		// Create the container
		this._container = DOM.$('.positron-plots-gallery-editor');
	}

	override dispose(): void {
		// Restore the plots view in the main window when this editor is closed
		// The context key will automatically show the view
		this._positronPlotsService.setDisplayLocation(PlotsDisplayLocation.MainWindow);

		super.dispose();
	}

	//#endregion Constructor

	//#region EditorPane Overrides

	protected override createEditor(parent: HTMLElement): void {
		// Append the container
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronPlotsGalleryEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		// Call the base class
		await super.setInput(input, options, context, token);

		// Set the display location to auxiliary window
		// This ensures plots appear in this editor, not in the main window view, if it is open
		this._positronPlotsService.setDisplayLocation(PlotsDisplayLocation.AuxiliaryWindow);

		// If we don't have a React renderer yet, create one and render the PositronPlots component
		if (!this._reactRenderer) {
			this._reactRenderer = this._register(new PositronReactRenderer(this._container));
			this._reactRenderer.render(
				<PositronPlots reactComponentContainer={this} />
			);
		}

		// Fire visibility changed event
		this._onVisibilityChangedEmitter.fire(this.isVisible());
	}

	override clearInput(): void {
		// Fire visibility changed event
		this._onVisibilityChangedEmitter.fire(false);

		// Call the base class
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		// Update dimensions
		this._width = dimension.width;
		this._height = dimension.height;

		// Fire size changed event
		this._onSizeChangedEmitter.fire({
			width: dimension.width,
			height: dimension.height
		});

		// Fire position changed event
		const bounding = this._container.getBoundingClientRect();
		this._onPositionChangedEmitter.fire({
			x: bounding.x,
			y: bounding.y
		});
	}

	override focus(): void {
		super.focus();
		this._onFocusedEmitter.fire();
	}

	//#endregion EditorPane Overrides
}
