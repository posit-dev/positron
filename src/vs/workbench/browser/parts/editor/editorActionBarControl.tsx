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
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';
import { SettingsEditor2Input } from '../../../services/preferences/common/preferencesEditorInput.js';
import { EditorActionBarOptions, EditorOption } from '../../../../editor/common/config/editorOptions.js';
import { PositronDataExplorerEditorInput } from '../../../contrib/positronDataExplorerEditor/browser/positronDataExplorerEditorInput.js';

/**
 * Constants.
 */
const EDITOR_ACTION_BAR_HEIGHT = 28;
export const EDITOR_ACTION_BAR_HIDDEN_FOR_LANGUAGES_SETTING = 'editor.actionBar.hiddenForLanguages';

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
	 * @param _accessibilityService The accessibility service.
	 * @param _commandService The command service.
	 * @param _configurationService The configuration service.
	 * @param _contextKeyService The context key service.
	 * @param _contextMenuService The context menu service.
	 * @param _hoverService The hover service.
	 * @param _keybindingService The keybinding service.
	 * @param _layoutService The layout service.
	 * @param _menuService The menu service.
	 * @param _telemetryService The telemetry service.
	 * @param _themeService The theme service.
	 */
	constructor(
		private readonly _parent: HTMLElement,
		private readonly _editorGroup: IEditorGroupView,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IMenuService private readonly _menuService: IMenuService,
		@ITelemetryService _telemetryService: ITelemetryService,
		@IThemeService private readonly _themeService: IThemeService,
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
			<EditorActionBar
				accessibilityService={this._accessibilityService}
				commandService={this._commandService}
				configurationService={this._configurationService}
				contextKeyService={this._contextKeyService}
				contextMenuService={this._contextMenuService}
				editorActionBarFactory={editorActionBarFactory}
				hoverService={this._hoverService}
				keybindingService={this._keybindingService}
				layoutService={this._layoutService}
				themeService={this._themeService}
			/>
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
	 * The editor disposables. Whenever the active editor changes, this is cleared and new event
	 * listeners are added to the new active editor.
	 */
	private readonly _editorDisposables = new DisposableStore();


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
	 * @param _instantiationService The instantiation service.
	 */
	constructor(
		private readonly _container: HTMLElement,
		private readonly _editorGroup: IEditorGroupView,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		/**
		 * Add the onDidActiveEditorChange event listener to listen for when the active editor changes.
		 */
		this._disposables.add(this._editorGroup.onDidActiveEditorChange(e => {
			// Set up the editor.
			this.setupEditor(e.editor);
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
	 * Sets up the editor.
	 * @param editorInput The editor input.
	 */
	private setupEditor(editorInput: EditorInput | undefined) {
		// Dispose of the previous editor disposables.
		this._editorDisposables.clear();

		// If there isn't an active editor, disable the editor action bar and return.
		if (!editorInput) {
			this.updateEnablement(false);
			return;
		}

		// Data Explorer always enables editor action bar.
		if (editorInput.typeId === PositronDataExplorerEditorInput.TypeID) {
			this.updateEnablement(true);
			return;
		}

		// Settings always enables editor action bar.
		if (editorInput.typeId === SettingsEditor2Input.ID) {
			this.updateEnablement(true);
			return;
		}

		// Get the active editor pane. If there isn't one, disable the editor action bar and return.
		const activeEditorPane = this._editorGroup.activeEditorPane;
		if (!activeEditorPane) {
			this.updateEnablement(false);
			return;
		}

		// Get editor control. If it's not code editor, disable the editor action bar and return.
		const editorControl = activeEditorPane.getControl();
		if (!isCodeEditor(editorControl)) {
			this.updateEnablement(false);
			return;
		}

		// Get the text model. If there isn't one, disable the editor action bar and return.
		const textModel = editorControl.getModel();
		if (!textModel) {
			this.updateEnablement(false);
			return;
		}

		// Update the enablement based on the text model's language.
		this.updateEnablementForLanguageAndOptions(textModel.getLanguageId(), editorControl.getOption(EditorOption.actionBar));

		// Add a listener for language changes on the text model. This ensures enablement is updated
		// when the language changes, which is especially important when Positron restores editors
		// before language extensions have fully loaded.
		this._editorDisposables.add(textModel.onDidChangeLanguage(e => {
			this.updateEnablementForLanguageAndOptions(textModel.getLanguageId(), editorControl.getOption(EditorOption.actionBar));
		}));

		// Add a listener for configuration changes on the editor control. This ensures enablement is
		// updated when the configuration changes.
		this._editorDisposables.add(editorControl.onDidChangeConfiguration(e => {
			this.updateEnablementForLanguageAndOptions(textModel.getLanguageId(), editorControl.getOption(EditorOption.actionBar));
		}));
	}

	/**
	 * Udpates the enablement for the specified language.
	 * @param language
	 */
	private updateEnablementForLanguageAndOptions(language: string, editorActionBarOptions: EditorActionBarOptions) {
		// Make a set of the hidden languages.
		const hiddenForLanguages = new Set(editorActionBarOptions.hiddenForLanguages);

		// If the language is not in the set of hidden languages, enable the editor action bar;
		// otherwise, disable it.
		if (!hiddenForLanguages.has('*') && !hiddenForLanguages.has(language)) {
			this.updateEnablement(true);
		} else {
			this.updateEnablement(false);
		}
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
