/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import * as DOM from '../../../../base/browser/dom.js';
import { IReactComponentContainer, ISize, PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { EditorActivation, IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { PositronPlotsContextProvider } from '../../positronPlots/browser/positronPlotsContext.js';
import { EditorPlotsContainer } from './editorPlotsContainer.js';
import { PositronPlotsEditorInput } from './positronPlotsEditorInput.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronPlotClient, IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';

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
	private _plotClient: IPositronPlotClient | undefined;

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
		if (this.input) {
			this._group.openEditor(this.input, { activation: EditorActivation.ACTIVATE });
		}
		this.focus();
	}

	readonly onSizeChanged = this._onSizeChangedEmitter.event;

	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChangedEmitter.event;

	readonly onSaveScrollPosition: Event<void> = this._onSaveScrollPositionEmitter.event;

	readonly onRestoreScrollPosition: Event<void> = this._onRestoreScrollPositionEmitter.event;

	readonly onFocused: Event<void> = this._onFocusedEmitter.event;

	constructor(
		readonly _group: IEditorGroup,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPreferencesService private readonly _preferencesService: IPreferencesService,
		@ICommandService private readonly _commandService: ICommandService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@ILayoutService private readonly _layoutService: ILayoutService,
	) {
		super(
			PositronPlotsEditorInput.EditorID,
			_group,
			telemetryService,
			themeService,
			storageService
		);

		this._container = DOM.$('.positron-plots-editor-container');
		this._container.onclick = () => this.takeFocus();
	}

	private renderContainer(plotClient: IPositronPlotClient): void {
		if (!this._reactRenderer) {
			this._reactRenderer = new PositronReactRenderer(this._container);
		}

		this._reactRenderer.render(
			<PositronPlotsContextProvider
				accessibilityService={this._accessibilityService}
				commandService={this._commandService}
				configurationService={this._configurationService}
				contextKeyService={this._contextKeyService}
				contextMenuService={this._contextMenuService}
				hoverService={this._hoverService}
				keybindingService={this._keybindingService}
				languageRuntimeService={this._languageRuntimeService}
				layoutService={this._layoutService}
				notificationService={this._notificationService}
				positronPlotsService={this._positronPlotsService}
				preferencesService={this._preferencesService}
			>
				<EditorPlotsContainer
					height={this._height}
					plotClient={plotClient}
					positronPlotsService={this._positronPlotsService}
					width={this._width}
				/>
			</PositronPlotsContextProvider>
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
		input: PositronPlotsEditorInput,
		options: IPositronPlotsEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		this._plotClient = this._positronPlotsService.getEditorInstance(input.resource.path);
		if (!this._plotClient) {
			throw new Error('Plot client not found');
		}

		input.setName(`Plot: ${this._plotClient.id}`);

		this.renderContainer(this._plotClient);
		this.onSizeChanged((event: ISize) => {
			this._height = event.height;
			this._width = event.width;

			if (this._plotClient) {
				this.renderContainer(this._plotClient);
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
			height: this._height
		});
	}

	override dispose(): void {
		this.disposeReactRenderer();
		super.dispose();
	}

	override focus(): void {
		super.focus();
		this._container.focus();
	}
}

