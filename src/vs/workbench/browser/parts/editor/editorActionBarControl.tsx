/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorActionBarControl.css';

// React.
import * as React from 'react';

// Other dependencies.
import { Emitter } from '../../../../base/common/event.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IEditorGroupView } from './editor.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { EditorActionBar } from './editorActionBar.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Constants.
 */
const EDITOR_ACTION_BAR_HEIGHT = 32;
const CONFIGURATION_SETTING = 'editor.actionBar.enabled';

/**
 * EditorActionBarControl class.
 */
export class EditorActionBarControl extends Disposable {
	//#region Private Properties

	/**
	 * Gets or sets the container.
	 */
	private _container?: HTMLElement;

	/**
	 * Gets or sets the React renderer used to render the editor action bar component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;

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

	/**
	 * Dispose method.
	 */
	override dispose() {
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

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Properties

	/**
	 * Gets the editor action bar height.
	 */
	get height() {
		return EDITOR_ACTION_BAR_HEIGHT;
	}

	//#endregion Public Properties

	//#region Public Methods

	/**
	 * Update method.
	 */
	update() {
		// TODO
	}

	//#endregion Public Methods
}

/**
 * EditorActionBarControlFactory class.
 */
export class EditorActionBarControlFactory {
	//#region Private Properties

	/**
	 * The disposables.
	 */
	private readonly _disposables = new DisposableStore();

	/**
	 * The control disposables.
	 */
	private readonly _controlDisposables = new DisposableStore();

	/**
	 * Gets or sets the editor action bar control.
	 */
	private _control?: EditorActionBarControl;

	/**
	 * Gets the onDidEnablementChange event emitter.
	 */
	private readonly _onDidEnablementChangeEmitter = this._disposables.add(new Emitter<void>());

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the control.
	 */
	get control() {
		return this._control;
	}

	//#endregion Public Properties

	//#region Public Events

	/**
	 * The onDidEnablementChange event.
	 */
	readonly onDidEnablementChange = this._onDidEnablementChangeEmitter.event;

	//#endregion Public Events

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param _container The container.
	 * @param _editorGroup The editor group.
	 * @param configurationService The configuration service.
	 * @param _instantiationService The instantiation service.
	 */
	constructor(
		private readonly _container: HTMLElement,
		private readonly _editorGroup: IEditorGroupView,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		// Check if the configuration setting is enabled. If so, create the control.
		if (configurationService.getValue<boolean>(CONFIGURATION_SETTING)) {
			this.createControl();
		}

		/**
		 * Add the onDidCloseEditor event listener to listen for when an editor is closed.
		 */
		this._disposables.add(this._editorGroup.onDidCloseEditor(() => {
			// TODO
		}));

		// Add the onDidChangeConfiguration event listener to listen for changes to the
		// configuration setting.
		this._disposables.add(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(CONFIGURATION_SETTING)) {
				if (configurationService.getValue(CONFIGURATION_SETTING)) {
					// Create the contorl if it doesn't exist.
					if (!this._control) {
						this.createControl();
					}
				} else {
					// Destroy the control if it exists.
					if (this._control) {
						this._controlDisposables.clear();
						this._control = undefined;
					}
				}

				// Fire the onDidEnablementChange event.
				this._onDidEnablementChangeEmitter.fire();
			}
		}));
	}

	/**
	 * Disposes the factory.
	 */
	dispose(): void {
		this._disposables.dispose();
		this._controlDisposables.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Private Methods

	/**
	 * Creates the control.
	 * @returns The control.
	 */
	private createControl() {
		this._control = this._controlDisposables.add(this._instantiationService.createInstance(
			EditorActionBarControl,
			this._container
		));
	}

	//#endregion Private Methods
}
