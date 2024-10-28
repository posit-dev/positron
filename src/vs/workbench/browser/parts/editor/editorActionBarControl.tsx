/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./editorActionBarControl';

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { EditorActionBar } from 'vs/workbench/browser/parts/editor/editorActionBar';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

/**
 * Constants.
 */
const EDITOR_ACTION_BAR_HEIGHT = 32;

/**
 * EditorActionBarControl class.
 */
export class EditorActionBarControl extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets a value which indicates whether the editor action bar is enabled.
	 */
	private _enabled = false;

	/**
	 * Gets or sets the container.
	 */
	private _container?: HTMLElement;

	/**
	 * Gets or sets the React renderer used to render the editor action bar component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

	/**
	 * The onDidEnablementChange event emitter.
	 */
	private readonly _onDidEnablementChangeEmitter = this._register(new Emitter<void>);

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param parent The parent HTML element.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _contextKeyService The context key service.
	 * @param _contextMenuService The context menu service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param themeService The theme service.
	 */
	constructor(
		private readonly _parent: HTMLElement,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		// Call the base class's constructor.
		super();

		// Layout the editor action bar.
		this.layout(_configurationService.getValue('editor.actionBar.enabled'));

		// Add the onDidChangeConfiguration event listener to listen for changes to the
		// editor.actionBar.enabled setting.
		this._register(_configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.actionBar.enabled')) {
				this.layout(_configurationService.getValue('editor.actionBar.enabled'));
			}
		}));
	}

	/**
	 * Dispose method.
	 */
	override dispose() {
		// Destroy the editor action bar.
		this.destroyEditorActionBar();

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Events

	/**
	 * The onDidEnablementChange event.
	 */
	readonly onDidEnablementChange = this._onDidEnablementChangeEmitter.event;

	//#endregion Public Events

	//#region Public Properties

	/**
	 * Gets a value which indicates whether the editor action bar is enabled.
	 */
	get enabled() {
		return this._enabled;
	}

	/**
	 * Gets the editor action bar height.
	 */
	get height() {
		return EDITOR_ACTION_BAR_HEIGHT;
	}

	//#endregion Public Properties

	//#region Private Methods

	/**
	 * Lays out the editor action bar.
	 * @param enabled A value which indicates whether the editor action bar is enabled.
	 */
	private layout(enabled: boolean) {
		// If the editor action bar is already enabled or disabled, return.
		if (this._enabled === enabled) {
			return;
		}

		// Set the enabled flag.
		this._enabled = enabled;

		// Destroy the editor action bar.
		this.destroyEditorActionBar();

		// Layout the editor action bar.
		if (this._enabled) {
			// Create the editor action bar container.
			this._container = document.createElement('div');
			this._container.className = 'editor-action-bar-container';
			this._parent.appendChild(this._container);

			// Render the editor action bar component in the editor action bar container.
			this._positronReactRenderer = new PositronReactRenderer(this._container);
			this._positronReactRenderer.render(
				<EditorActionBar
					commandService={this._commandService}
					configurationService={this._configurationService}
					contextKeyService={this._contextKeyService}
					contextMenuService={this._contextMenuService}
					hoverService={this._hoverService}
					keybindingService={this._keybindingService}
				/>
			);
		}

		// Fire the onDidEnablementChange event.
		this._onDidEnablementChangeEmitter.fire();
	}

	/**
	 * Destroys the editor action bar.
	 */
	private destroyEditorActionBar() {
		// Dispose the React renderer.
		if (this._positronReactRenderer) {
			this._positronReactRenderer.dispose();
			this._positronReactRenderer = undefined;
		}

		// Remove the container.
		if (this._container) {
			this._container.remove();
			this._container = undefined;
		}
	}

	//#endregion Private Methods
}
