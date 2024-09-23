/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
// import { ICommandService } from 'vs/platform/commands/common/commands';
// import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
// import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
// import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
// import { IHoverService } from 'vs/platform/hover/browser/hover';
// import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
// import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronPreviewContextProvider } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';
import { PositronPreviewEditorInput } from 'vs/workbench/contrib/positronPreviewEditor/browser/positronPreviewEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
// import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreview'

export interface IPositronPreviewEditorOptions extends IEditorOptions {
}

export interface IPositronPreviewEditor {
	get identifier(): string | undefined;
}

export class PositronPreviewEditor extends EditorPane implements IPositronPreviewEditor, IReactComponentContainer {
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

	//private _previewClient: IPositronPreviewClient | undefined;

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
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
		// @ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		// @INotificationService private readonly _notificationService: INotificationService,
		// @ICommandService private readonly _commandService: ICommandService,
		// @IHoverService private readonly _hoverService: IHoverService,
		// @IKeybindingService private readonly _keybindingService: IKeybindingService,
		// @IConfigurationService private readonly _configurationService: IConfigurationService,
		// @IContextKeyService private readonly _contextKeyService: IContextKeyService,
		// @IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
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
		if (!this._reactRenderer) {
			this._reactRenderer = new PositronReactRenderer(this._container);
		}

		this._reactRenderer.render(
			<PositronPreviewContextProvider
				positronPreviewService={this._positronPreviewService}
			>
			</PositronPreviewContextProvider>
			// TODO: do we need a preview container?
			// TODO: other services?
		);
	}

	private disposeReactRenderer(): void {
		this._reactRenderer?.dispose();
		this._reactRenderer = undefined;
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
		// this._previewClient?.dispose();
		// this._previewClient = this._positronPreviewService.activePreviewWebview;
		// if (!this._previewClient) {
		// 	throw new Error('Preview client not found');
		// }

		// input.setName(this._previewClient.id);

		this.renderContainer();
		// this.onSizeChanged((event: ISize) => {
		// 	this._height = event.height;
		// 	this._width = event.width;

		// 	if (this._previewClient) {
		// 		this.renderContainer(this._previewClient);
		// 	}
		// });

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

	override dispose(): void {
		this.disposeReactRenderer();
		super.dispose();
	}
}

