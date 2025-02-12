/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from '../../../../base/browser/dom.js';
import {
	IReactComponentContainer,
	ISize,
	PositronReactRenderer,
} from '../../../../base/browser/positronReactRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { PositronPreviewContextProvider } from '../../positronPreview/browser/positronPreviewContext.js';
import { PositronPreviewEditorInput } from './positronPreviewEditorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { IPositronPreviewService } from '../../positronPreview/browser/positronPreview.js';
import { EditorPreviewContainer } from './editorPreviewContainer.js';
import { PreviewWebview } from '../../positronPreview/browser/previewWebview.js';

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
					height={this._height}
					preview={this._preview}
					visible={this._visible}
					width={this._width}
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

		// If there is an identifier, clear it.
		if (this._identifier && this._preview) {
			this._preview.dispose();
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

		if (this._preview) {
			this._preview.dispose();
		}

		super.dispose();
	}
}
