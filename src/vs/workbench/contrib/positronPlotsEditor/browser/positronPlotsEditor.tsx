/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { DynamicPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/dynamicPlotInstance';
import { StaticPlotInstance } from 'vs/workbench/contrib/positronPlots/browser/components/staticPlotInstance';
import { ZoomLevel } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { PositronPlotsContextProvider } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { EditorPlotsContainer } from 'vs/workbench/contrib/positronPlotsEditor/browser/editorPlotsContainer';
import { PositronPlotsEditorInput } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditorInput';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotClient, IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

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
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
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

	private renderContainer(plotClient: IPositronPlotClient): void {
		if (!this._reactRenderer) {
			this._reactRenderer = new PositronReactRenderer(this._container);
		}

		this._reactRenderer.render(
			<PositronPlotsContextProvider
				commandService={this._commandService}
				configurationService={this._configurationService}
				contextKeyService={this._contextKeyService}
				contextMenuService={this._contextMenuService}
				hoverService={this._hoverService}
				keybindingService={this._keybindingService}
				languageRuntimeService={this._languageRuntimeService}
				positronPlotsService={this._positronPlotsService}
				notificationService={this._notificationService}
			>
				<EditorPlotsContainer
					width={this._width}
					height={this._height}
					plotClient={plotClient}
				/>
			</PositronPlotsContextProvider>
		);
	}

	protected override createEditor(parent: HTMLElement): void {
		// const focusTracker = this._register(DOM.trackFocus(parent));

		parent.appendChild(this._container);
	}

	render = (plotClient?: IPositronPlotClient) => {
		if (plotClient instanceof PlotClientInstance) {
			return <DynamicPlotInstance
				key={plotClient.id}
				width={this._width}
				height={this._height}
				plotClient={plotClient}
				zoom={ZoomLevel.Fill} />;
		}
		if (plotClient instanceof StaticPlotClient) {
			return <StaticPlotInstance
				key={plotClient.id}
				plotClient={plotClient}
				zoom={ZoomLevel.OneHundred} />;
		}

		return null;
	};

	renderPlot = (plotClient: IPositronPlotClient) => {
		if (plotClient instanceof PlotClientInstance) {
			const dynamicPlot = plotClient as PlotClientInstance;
			dynamicPlot.render(this._height, this._width, 1);
		}
	};

	override async setInput(
		input: PositronPlotsEditorInput,
		options: IPositronPlotsEditorOptions,
		context: IEditorOpenContext,
		token: CancellationToken
	): Promise<void> {
		const plotClient = this._positronPlotsService.getEditorInstance(input.resource.path);
		if (!plotClient) {
			throw new Error('Plot client not found');
		}

		input.setName(plotClient.id);

		// this.renderPlot(plotClient);
		this.renderContainer(plotClient);
		this.onSizeChanged((event: ISize) => {
			this._height = event.height;
			this._width = event.width;

			this.renderContainer(plotClient);
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
}

