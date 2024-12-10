/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import {
	IReactComponentContainer,
	ISize,
	PositronReactRenderer,
} from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronPreviewContextProvider } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';
import { PositronPreviewEditorInput } from 'vs/workbench/contrib/positronPreviewEditor/browser/positronPreviewEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview';
import { EditorPreviewContainer } from 'vs/workbench/contrib/positronPreviewEditor/browser/editorPreviewContainer';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';

export interface IPositronPreviewEditorOptions extends IEditorOptions {
	get identifier(): string | undefined;
}

export class PositronPreviewEditor
	extends EditorPane
	implements IReactComponentContainer {
	private readonly _container: HTMLElement;

	private _positronReactRenderer?: PositronReactRenderer;

	private _width = 0;

	private _height = 0;

	private _visible = true;

	private _identifier?: string;

	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	private readonly _onVisibilityChangedEmitter = this._register(
		new Emitter<boolean>()
	);

	private readonly _onSaveScrollPositionEmitter = this._register(
		new Emitter<void>()
	);

	private readonly _onRestoreScrollPositionEmitter = this._register(
		new Emitter<void>()
	);

	private readonly _onFocusedEmitter = this._register(new Emitter<void>());

	private _preview: PreviewWebview | undefined;

	get identifier(): string | undefined {
		return this._identifier;
	}

	get width() {
		return this._width;
	}

	get height() {
		return this._height;
	}

	get containerVisible() {
		return this._visible;
	}

	takeFocus(): void {
		this.focus();
	}

	readonly onSizeChanged = this._onSizeChangedEmitter.event;

	readonly onVisibilityChanged: Event<boolean> =
		this._onVisibilityChangedEmitter.event;

	readonly onSaveScrollPosition: Event<void> =
		this._onSaveScrollPositionEmitter.event;

	readonly onRestoreScrollPosition: Event<void> =
		this._onRestoreScrollPositionEmitter.event;

	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	constructor(
		readonly _group: IEditorGroup,
		@IPositronPreviewService
		private readonly _positronPreviewService: IPositronPreviewService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService
	) {
		super(
			PositronPreviewEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);
		this._container = DOM.$('.positron-preview-editor-container');

		this._register(this.onVisibilityChanged(visible => {
			if (!visible) {
				this._onSaveScrollPositionEmitter.fire();
			} else {
				this._onRestoreScrollPositionEmitter.fire();
			}
			this._onVisibilityChangedEmitter.fire(visible);
		}
		));
	}

	private renderContainer(previewId: string): void {
		if (!this._positronReactRenderer) {
			this._positronReactRenderer = new PositronReactRenderer(this._container);
		}
		this._preview = this._positronPreviewService.editorWebview(previewId);

		this._positronReactRenderer.render(
			<PositronPreviewContextProvider
				positronPreviewService={this._positronPreviewService}
			>
				<EditorPreviewContainer
					preview={this._preview}
					width={this._width}
					height={this._height}
					visible={this._visible}
				/>
			</PositronPreviewContextProvider>
		);
	}

	private disposeReactRenderer(): void {
		this._positronReactRenderer?.dispose();
		this._positronReactRenderer = undefined;
	}

	protected override createEditor(parent: HTMLElement): void {
		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronPreviewEditorInput,
		options: IPositronPreviewEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		this._identifier = input._previewId;

		if (!this._identifier) { return; }

		this.renderContainer(this._identifier);

		// redraw if the editor is resized
		this.onSizeChanged((event: ISize) => {
			this._height = event.height;
			this._width = event.width;

			if (this._positronReactRenderer && this._identifier) {
				this.renderContainer(this._identifier);
			}
		});

		await super.setInput(input, options, context, token);
	}

	/**
	 * Clears the input.
	 */
	override clearInput(): void {
		// Dispose the PositronReactRenderer.
		this.disposeReactRenderer();

		// // If there is an identifier, clear it.
		if (this._identifier) {
			// Clear the focused Positron data explorer.
			//this._positronPreviewService.editorWebview(this._identifier)?.dispose();

			// Clear the identifier.
			this._identifier = undefined;
		}

		// Call the base class's method.
		super.clearInput();
	}

	/**
	 * Sets editor visibility.
	 * @param visible A value which indicates whether the editor should be visible.
	 */
	protected override setEditorVisible(visible: boolean): void {
		// Call the base class's method.
		super.setEditorVisible(visible);
		this._onVisibilityChangedEmitter.fire(visible);
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);

		this._width = dimension.width;
		this._height = dimension.height;

		this._onSizeChangedEmitter.fire({
			width: this._width,
			height: this._height,
		});
	}

	override dispose(): void {
		this.disposeReactRenderer();

		// if there is a preview, dispose it.
		if (this._preview) {
			this._preview.dispose();
		}

		super.dispose();
	}
}
