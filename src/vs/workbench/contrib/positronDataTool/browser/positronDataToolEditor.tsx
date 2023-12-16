/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronDataToolEditor';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { PositronDataTool } from 'vs/workbench/contrib/positronDataTool/browser/positronDataTool';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { PositronDataToolEditorInput } from 'vs/workbench/contrib/positronDataTool/browser/positronDataToolEditorInput';

// Temporary instance counter.
let instance = 0;

/**
 * IPositronDataToolEditorOptions interface.
 */
export interface IPositronDataToolEditorOptions extends IEditorOptions {
}

/**
 * PositronDataToolEditor class.
 */
export class PositronDataToolEditor extends EditorPane implements IReactComponentContainer {
	//#region Static Properties

	//#endregion Static Properties

	//#region Private Properties

	/**
	 * The onSizeChanged event emitter.
	 */
	private _onSizeChangedEmitter = this._register(new Emitter<ISize>());

	/**
	 * The onVisibilityChanged event emitter.
	 */
	private _onVisibilityChangedEmitter = this._register(new Emitter<boolean>());

	/**
	 * The onSaveScrollPosition event emitter.
	 */
	private _onSaveScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onRestoreScrollPosition event emitter.
	 */
	private _onRestoreScrollPositionEmitter = this._register(new Emitter<void>());

	/**
	 * The onFocused event emitter.
	 */
	private _onFocusedEmitter = this._register(new Emitter<void>());

	/**
	 * Gets or sets the container element.
	 */
	private _positronDataToolsContainer!: HTMLElement;

	/**
	 * Gets or sets the PositronReactRenderer for the PositronDataTool component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * Gets or sets the width. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _width = 0;

	/**
	 * Gets or sets the height. This value is set in layoutBody and is used to implement the
	 * IReactComponentContainer interface.
	 */
	private _height = 0;

	/**
	 * Gets the instance. This is a temporary property.
	 */
	private instance = `${++instance}`;

	//#endregion Private Properties

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
		return this.isVisible();
	}

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus() {
		this.focus();
	}

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged(focused: boolean) {
		// this._positronVariablesFocusedContextKey?.set(focused);
	}

	/**
	 * The onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize> = this._onSizeChangedEmitter.event;

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

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param clipboardService The clipboard service.
	 * @param storageService The storage service.
	 * @param telemetryService The telemetry service.
	 * @param themeService The theme service.
	 */
	constructor(
		@IClipboardService readonly clipboardService: IClipboardService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
	) {
		// Call the base class's constructor.
		super(PositronDataToolEditorInput.EditorID, telemetryService, themeService, storageService);

		// Logging.
		console.log(`PositronDataEditor ${this.instance} constructor`);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Call the base class's dispose method.
		super.dispose();

		// Logging.
		console.log(`PositronDataEditor ${this.instance} dispose`);
	}

	//#endregion Constructor & Dispose

	//#region Protected Overrides

	/**
	 * Creates the editor.
	 * @param parent The parent HTML element.
	 */
	protected override createEditor(parent: HTMLElement): void {
		// Logging.
		console.log(`PositronDataEditor ${this.instance} createEdtitor`);

		// Create and append the Positron data tool container.
		this._positronDataToolsContainer = DOM.$('.positron-data-tool-container');
		parent.appendChild(this._positronDataToolsContainer);

		// Create the PositronReactRenderer for the PositronDataTool component and render it.
		this._positronReactRenderer = new PositronReactRenderer(this._positronDataToolsContainer);
		this._register(this._positronReactRenderer);
		this._positronReactRenderer.render(
			<PositronDataTool
				clipboardService={this.clipboardService}
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				reactComponentContainer={this}
			/>
		);
	}

	/**
	 * Sets editor visibility.
	 * @param visible A value which indicates whether the editor should be visible.
	 * @param group The editor group.
	 */
	protected override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		// Call the base class's method.
		super.setEditorVisible(visible, group);

		// Logging.
		console.log(`PositronDataEditor ${this.instance} setEditorVisible ${visible} group ${group}`);
	}

	//#endregion Protected Overrides

	//#region Protected Overrides

	/**
	 * Lays out the editor.
	 * @param dimension The layout dimension.
	 */
	override layout(dimension: DOM.Dimension): void {
		// Size the container.
		DOM.size(this._positronDataToolsContainer, dimension.width, dimension.height);

		this._width = dimension.width;
		this._height = dimension.height;

		this._onSizeChangedEmitter.fire({
			width: this._width,
			height: this._height
		});
	}

	//#endregion Protected Overrides
}
