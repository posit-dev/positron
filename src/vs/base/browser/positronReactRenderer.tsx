/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React, { ReactElement } from 'react';
import { createRoot, Root } from 'react-dom/client';

// Other dependencies.
import { Event } from '../common/event.js';
import { ILogService } from '../../platform/log/common/log.js';
import { Disposable, IDisposable } from '../common/lifecycle.js';
import { ILabelService } from '../../platform/label/common/label.js';
import { IModelService } from '../../editor/common/services/model.js';
import { IHoverService } from '../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../workbench/common/views.js';
import { IThemeService } from '../../platform/theme/common/themeService.js';
import { ILanguageService } from '../../editor/common/languages/language.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { PositronReactRendererServicesContext } from './positronReactRendererContext.js';
import { IPathService } from '../../workbench/services/path/common/pathService.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
import { IQuickInputService } from '../../platform/quickinput/common/quickInput.js';
import { IWorkspacesService } from '../../platform/workspaces/common/workspaces.js';
import { ITextModelService } from '../../editor/common/services/resolverService.js';
import { IWebviewService } from '../../workbench/contrib/webview/browser/webview.js';
import { IViewsService } from '../../workbench/services/views/common/viewsService.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { IClipboardService } from '../../platform/clipboard/common/clipboardService.js';
import { IContextMenuService } from '../../platform/contextview/browser/contextView.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';
import { INotificationService } from '../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { IAccessibilityService } from '../../platform/accessibility/common/accessibility.js';
import { IInstantiationService } from '../../platform/instantiation/common/instantiation.js';
import { ILanguageModelsService } from '../../workbench/contrib/chat/common/languageModels.js';
import { IPreferencesService } from '../../workbench/services/preferences/common/preferences.js';
import { IWorkbenchLayoutService } from '../../workbench/services/layout/browser/layoutService.js';
import { IPositronPlotsService } from '../../workbench/services/positronPlots/common/positronPlots.js';
import { IPositronHelpService } from '../../workbench/contrib/positronHelp/browser/positronHelpService.js';
import { IRuntimeSessionService } from '../../workbench/services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../workbench/services/runtimeStartup/common/runtimeStartupService.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IPositronPreviewService } from '../../workbench/contrib/positronPreview/browser/positronPreviewSevice.js';
import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { IExecutionHistoryService } from '../../workbench/services/positronHistory/common/executionHistoryService.js';
import { IPositronConsoleService } from '../../workbench/services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronTopActionBarService } from '../../workbench/services/positronTopActionBar/browser/positronTopActionBarService.js';
import { IPositronVariablesService } from '../../workbench/services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronConnectionsService } from '../../workbench/services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IPositronWebviewPreloadService } from '../../workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { IPositronNotebookOutputWebviewService } from '../../workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronDataExplorerService } from '../../workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * ISize interface.
 */
export interface ISize {
	width: number;
	height: number;
}

/**
 * IElementPosition interface.
 */
export interface IElementPosition {
	x: number;
	y: number;
}

/**
 * IReactComponentContainer interface.
 */
export interface IReactComponentContainer {
	/**
	 * Gets the width.
	 */
	readonly width: number;

	/**
	 * Gets the height.
	 */
	readonly height: number;

	/**
	 * Gets the container visibility.
	 */
	readonly containerVisible: boolean;

	/**
	 * Directs the React component container to take focus.
	 */
	takeFocus(): void;

	/**
	 * Notifies the React component container when focus changes.
	 */
	focusChanged?(focused: boolean): void;

	/**
	 * Notifies the React component container when visibility changes.
	 */
	visibilityChanged?(visible: boolean): void;

	/**
	 * onFocused event.
	 */
	readonly onFocused: Event<void>;

	/**
	 * onSizeChanged event.
	 */
	readonly onSizeChanged: Event<ISize>;

	/**
	 * onVisibilityChanged event.
	 */
	readonly onVisibilityChanged: Event<boolean>;

	/**
	 * onSaveScrollPosition event.
	 */
	readonly onSaveScrollPosition: Event<void>;

	/**
	 * onRestoreScrollPosition event.
	 */
	readonly onRestoreScrollPosition: Event<void>;
}

/**
 * PositronReactRenderer class.
 * Manages rendering a React component in the specified container HTMLElement.
 */
export class PositronReactRenderer extends Disposable {
	//#region Private Properties

	/**
	 * The root where the React element will be rendered.
	 */
	private root?: Root;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Initializes a new instance of the ReactRenderer class.
	 * @param container The container HTMLElement where the React component will be rendered.
	 */
	constructor(
		container: HTMLElement,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IEditorService private readonly _editorService: IEditorService,
		@IExecutionHistoryService private readonly _executionHistoryService: IExecutionHistoryService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IHostService private readonly _hostService: IHostService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILabelService private readonly _labelService: ILabelService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ILogService private readonly _logService: ILogService,
		@IModelService private readonly _modelService: IModelService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IPathService private readonly _pathService: IPathService,
		@IPositronConnectionsService private readonly _positronConnectionsService: IPositronConnectionsService,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
		@IPositronDataExplorerService private readonly _positronDataExplorerService: IPositronDataExplorerService,
		@IPositronHelpService private readonly _positronHelpService: IPositronHelpService,
		@IPositronNotebookOutputWebviewService private readonly _positronNotebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IPositronPlotsService private readonly _positronPlotsService: IPositronPlotsService,
		@IPositronPreviewService private readonly _positronPreviewService: IPositronPreviewService,
		@IPositronTopActionBarService private readonly _positronTopActionBarService: IPositronTopActionBarService,
		@IPositronVariablesService private readonly _positronVariablesService: IPositronVariablesService,
		@IPositronWebviewPreloadService private readonly _positronWebviewPreloadService: IPositronWebviewPreloadService,
		@IPreferencesService private readonly _preferencesService: IPreferencesService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@IThemeService private readonly _themeService: IThemeService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly _viewsService: IViewsService,
		@IWebviewService private readonly _webviewService: IWebviewService,
		@IWorkbenchEnvironmentService private readonly _workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IWorkbenchLayoutService private readonly _workbenchLayoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IWorkspacesService private readonly _workspacesService: IWorkspacesService
	) {
		// Call the base class's constructor.
		super();

		// Create the root.
		this.root = createRoot(container);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Unmount and dispose of the root.
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Renders the React element that was supplied.
	 * @param reactElement The React element.
	 */
	public render(reactElement: ReactElement) {
		if (this.root) {
			this.root.render(
				<PositronReactRendererServicesContext.Provider value={{
					accessibilityService: this._accessibilityService,
					clipboardService: this._clipboardService,
					commandService: this._commandService,
					configurationService: this._configurationService,
					contextKeyService: this._contextKeyService,
					contextMenuService: this._contextMenuService,
					editorService: this._editorService,
					executionHistoryService: this._executionHistoryService,
					hoverService: this._hoverService,
					hostService: this._hostService,
					instantiationService: this._instantiationService,
					keybindingService: this._keybindingService,
					labelService: this._labelService,
					languageModelsService: this._languageModelsService,
					languageRuntimeService: this._languageRuntimeService,
					languageService: this._languageService,
					logService: this._logService,
					modelService: this._modelService,
					notificationService: this._notificationService,
					openerService: this._openerService,
					pathService: this._pathService,
					positronConnectionsService: this._positronConnectionsService,
					positronConsoleService: this._positronConsoleService,
					positronDataExplorerService: this._positronDataExplorerService,
					positronHelpService: this._positronHelpService,
					positronNotebookOutputWebviewService: this._positronNotebookOutputWebviewService,
					positronPlotsService: this._positronPlotsService,
					positronPreviewService: this._positronPreviewService,
					positronTopActionBarService: this._positronTopActionBarService,
					positronVariablesService: this._positronVariablesService,
					positronWebviewPreloadService: this._positronWebviewPreloadService,
					preferencesService: this._preferencesService,
					quickInputService: this._quickInputService,
					runtimeSessionService: this._runtimeSessionService,
					runtimeStartupService: this._runtimeStartupService,
					textModelService: this._textModelService,
					themeService: this._themeService,
					viewDescriptorService: this._viewDescriptorService,
					viewsService: this._viewsService,
					webviewService: this._webviewService,
					workbenchEnvironmentService: this._workbenchEnvironmentService,
					workbenchLayoutService: this._workbenchLayoutService,
					workspaceContextService: this._workspaceContextService,
					workspacesService: this._workspacesService
				}}>
					{reactElement}
				</PositronReactRendererServicesContext.Provider>
			);
		}
	}

	/**
	 * Registers an IDisposable with the same lifecycle as the PositronReactRenderer.
	 * @param disposable The IDisposable.
	 */
	public register(disposable: IDisposable) {
		this._register(disposable);
	}

	/**
	 * Destroys the ReactRenderer.
	 * @deprecated Use Disposable instead.
	 */
	public destroy() {
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}
	}

	//#endregion Public Methods
}
