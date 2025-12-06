/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorActionBarControl.css';

// React.
import React from 'react';

// Other dependencies.
import { IEditorGroupView } from './editor.js';
import { EditorActionBar } from './editorActionBar.js';
import { Emitter } from '../../../../base/common/event.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorActionBarFactory } from './editorActionBarFactory.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { NotebookEditorInput } from '../../../contrib/notebook/common/notebookEditorInput.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { SettingsEditor2Input } from '../../../services/preferences/common/preferencesEditorInput.js';
import { NotebookOutputEditorInput } from '../../../contrib/notebook/browser/outputEditor/notebookOutputEditorInput.js';
import { IsAuxiliaryWindowContext, IsCompactTitleBarContext } from '../../../common/contextkeys.js';

/**
 * Constants.
 */
const EDITOR_ACTION_BAR_HEIGHT = 28;
const EDITOR_ACTION_BAR_CONFIGURATION_SETTING = 'editor.actionBar.enabled';

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
	 * @param _parent The parent HTML element.
	 * @param _editorGroup The editor group.
	 */
	constructor(
		private readonly _parent: HTMLElement,
		private readonly _editorGroup: IEditorGroupView,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IMenuService private readonly _menuService: IMenuService,
		@ITelemetryService _telemetryService: ITelemetryService,
	) {
		// Call the base class's constructor.
		super();

		// Create the editor action bar container.
		this._container = document.createElement('div');
		this._container.className = 'editor-action-bar-container';
		this._parent.appendChild(this._container);

		// Create the editor action bar factory.
		const editorActionBarFactory = this._register(new EditorActionBarFactory(
			this._editorGroup,
			this._contextKeyService,
			this._keybindingService,
			this._menuService,
		));

		// Render the editor action bar component in the editor action bar container.
		this._positronReactRenderer = this._register(new PositronReactRenderer(this._container));
		this._positronReactRenderer.render(
			<EditorActionBar editorActionBarFactory={editorActionBarFactory} />
		);
	}

	/**
	 * Disposes the editor action bar control.
	 */
	override dispose() {
		// Remove the editor action bar container.
		this._container?.remove();

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
	 * @param _configurationService The configuration service.
	 * @param _instantiationService The instantiation service.
	 */
	constructor(
		private readonly _container: HTMLElement,
		private readonly _editorGroup: IEditorGroupView,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService
	) {
		// Update the enablement for the active editor.
		this.updateEnablementForEditorInput(this._editorGroup.activeEditor);

		// Add the onDidActiveEditorChange event listener to listen for when the active editor changes.
		this._disposables.add(this._editorGroup.onDidActiveEditorChange(e => {
			// Set up the editor.
			this.updateEnablementForEditorInput(e.editor);
		}));

		// Add the onDidChangeConfiguration event listener to listen for changes to the configuration setting.
		this._disposables.add(this._configurationService.onDidChangeConfiguration(e => {
			// Check if the editor action bar configuration setting has changed.
			if (e.affectsConfiguration(EDITOR_ACTION_BAR_CONFIGURATION_SETTING)) {
				this.updateEnablementForEditorInput(this._editorGroup.activeEditor);
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
	 * Updates enablement for the specified editor input.
	 * @param editorInput The editor input.
	 */
	private updateEnablementForEditorInput(editorInput: EditorInput | undefined | null) {
		// If there isn't an active editor, disable the editor action bar and return.
		if (!editorInput) {
			this.updateEnablement(false);
			return;
		}

		// Auxiliary windows in compact mode always disable the editor action bar.
		const isAuxiliaryWindow = IsAuxiliaryWindowContext.getValue(this._contextKeyService);
		const isCompact = IsCompactTitleBarContext.getValue(this._contextKeyService);
		if (isAuxiliaryWindow && isCompact) {
			this.updateEnablement(false);
			return;
		}

		// Notebooks always disable the editor action bar.
		if (editorInput.typeId === NotebookEditorInput.ID || editorInput.typeId === NotebookOutputEditorInput.ID) {
			this.updateEnablement(false);
			return;
		}

		// Settings always enables editor action bar.
		if (editorInput.typeId === SettingsEditor2Input.ID) {
			this.updateEnablement(true);
			return;
		}

		// Update enablement based on the configuration setting.
		this.updateEnablement(this._configurationService.getValue<boolean>(EDITOR_ACTION_BAR_CONFIGURATION_SETTING));
	}

	/**
	 * Updates enablement.
	 * @param enabled true to enable, false to disable.
	 */
	private updateEnablement(enabled: boolean) {
		// Update enablement.
		if (enabled) {
			// Create the control, if it doesn't exist.
			if (!this._control) {
				// Create the control.
				this._control = this._controlDisposables.add(this._instantiationService.createInstance(
					EditorActionBarControl,
					this._container,
					this._editorGroup
				));
			}
		} else {
			// Destroy the control, if it exists.
			if (this._control) {
				this._controlDisposables.clear();
				this._control = undefined;
			}
		}

		// Fire the onDidEnablementChange event.
		this._onDidEnablementChangeEmitter.fire();
	}

	//#endregion Private Methods
}
