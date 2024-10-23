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

export interface IPositronPreviewEditorOptions extends IEditorOptions { }

export interface IPositronPreviewEditor {
	get identifier(): string | undefined;
}

export class PositronPreviewEditor
	extends EditorPane
	implements IReactComponentContainer {
	private readonly _container: HTMLElement;

	private _positronReactRenderer?: PositronReactRenderer;

	private _width = 0;

	private _height = 0;

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
		return this.isVisible();
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

	private renderContainer(): void {
		if (!this._positronReactRenderer) {
			this._positronReactRenderer = new PositronReactRenderer(this._container);
		}

		this._positronReactRenderer.render(
			<PositronPreviewContextProvider
				positronPreviewService={this._positronPreviewService}
			>
				<EditorPreviewContainer
					preview={this._positronPreviewService.activePreviewWebview}
					visible={this.containerVisible}
					width={this._width}
					height={this._height}
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
		this.renderContainer();
		this.onSizeChanged((event: ISize) => {
			this._height = event.height;
			this._width = event.width;

			if (this._positronReactRenderer) {
				this.renderContainer();
			}
		});

		await super.setInput(input, options, context, token);
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
		super.dispose();
	}
}
