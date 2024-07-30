/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronPlotsEditorInput } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';

export interface IPositronPlotsEditorOptions extends IEditorOptions {
}

export interface IPositronPlotsEditor {
	get identifier(): string | undefined;
}

export class PositronPlotsEditor extends EditorPane implements IPositronPlotsEditor, IReactComponentContainer {
	private readonly _container: HTMLElement;

	private _reactRenderer?: PositronReactRenderer;

	private _width = 0;

	private _height = 0;

	private _identifier?: string;

	private readonly _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	private readonly _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	private readonly _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	private readonly _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

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

	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;

	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;

	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	constructor(
		readonly _group: IEditorGroup,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		super(
			PositronPlotsEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._container = DOM.$('.positron-plots-editor-container');
	}

	protected override createEditor(parent: HTMLElement): void {
		// const focusTracker = this._register(DOM.trackFocus(parent));

		parent.appendChild(this._container);
	}

	override async setInput(
		input: PositronPlotsEditorInput,
		options: IPositronPlotsEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		if (!this._reactRenderer) {
			this._reactRenderer = new PositronReactRenderer(this._container);
		}
		this._reactRenderer.render(
			<div>
				<img src={`${input.resource.path}`} />
			</div>
		);

		await super.setInput(input, options, context, token);
	}

	override layout(dimension: DOM.Dimension): void {
		DOM.size(this._container, dimension.width, dimension.height);

		this._width = dimension.width;
		this._height = dimension.height;

		this._onSizeChangedEmitter.fire({
			width: this._width,
			height: this._height
		});
	}
}

