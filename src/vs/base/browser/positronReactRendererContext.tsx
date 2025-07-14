/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, useContext } from 'react';

// Other dependencies.
import { ILogService } from '../../platform/log/common/log.js';
import { ILabelService } from '../../platform/label/common/label.js';
import { IModelService } from '../../editor/common/services/model.js';
import { IHoverService } from '../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../workbench/common/views.js';
import { IThemeService } from '../../platform/theme/common/themeService.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { ILanguageService } from '../../editor/common/languages/language.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { IPathService } from '../../workbench/services/path/common/pathService.js';
import { ITextModelService } from '../../editor/common/services/resolverService.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { IQuickInputService } from '../../platform/quickinput/common/quickInput.js';
import { IWorkspacesService } from '../../platform/workspaces/common/workspaces.js';
import { IKeybindingService } from '../../platform/keybinding/common/keybinding.js';
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
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IRuntimeStartupService } from '../../workbench/services/runtimeStartup/common/runtimeStartupService.js';
import { IPositronPreviewService } from '../../workbench/contrib/positronPreview/browser/positronPreviewSevice.js';
import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { IExecutionHistoryService } from '../../workbench/services/positronHistory/common/executionHistoryService.js';
import { IPositronConsoleService } from '../../workbench/services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronTopActionBarService } from '../../workbench/services/positronTopActionBar/browser/positronTopActionBarService.js';
import { IPositronVariablesService } from '../../workbench/services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronConnectionsService } from '../../workbench/services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IPositronDataExplorerService } from '../../workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronWebviewPreloadService } from '../../workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { IPositronNotebookOutputWebviewService } from '../../workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService.js';

/**
 * PositronReactServices interface.
 */
export type PositronReactServices = {
	readonly accessibilityService: IAccessibilityService;
	readonly clipboardService: IClipboardService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly editorService: IEditorService;
	readonly executionHistoryService: IExecutionHistoryService;
	readonly hoverService: IHoverService;
	readonly hostService: IHostService,
	readonly instantiationService: IInstantiationService;
	readonly keybindingService: IKeybindingService;
	readonly labelService: ILabelService;
	readonly languageRuntimeService: ILanguageRuntimeService;
	readonly languageModelsService: ILanguageModelsService,
	readonly languageService: ILanguageService;
	readonly logService: ILogService;
	readonly modelService: IModelService;
	readonly notificationService: INotificationService;
	readonly openerService: IOpenerService;
	readonly pathService: IPathService;
	readonly positronConnectionsService: IPositronConnectionsService,
	readonly positronConsoleService: IPositronConsoleService;
	readonly positronDataExplorerService: IPositronDataExplorerService;
	readonly positronHelpService: IPositronHelpService;
	readonly positronNotebookOutputWebviewService: IPositronNotebookOutputWebviewService;
	readonly positronPlotsService: IPositronPlotsService;
	readonly positronPreviewService: IPositronPreviewService;
	readonly positronTopActionBarService: IPositronTopActionBarService;
	readonly positronVariablesService: IPositronVariablesService;
	readonly positronWebviewPreloadService: IPositronWebviewPreloadService;
	readonly preferencesService: IPreferencesService;
	readonly quickInputService: IQuickInputService;
	readonly runtimeSessionService: IRuntimeSessionService;
	readonly runtimeStartupService: IRuntimeStartupService;
	readonly textModelService: ITextModelService;
	readonly themeService: IThemeService;
	readonly viewDescriptorService: IViewDescriptorService;
	readonly viewsService: IViewsService;
	readonly webviewService: IWebviewService;
	readonly workbenchEnvironmentService: IWorkbenchEnvironmentService;
	readonly workbenchLayoutService: IWorkbenchLayoutService;
	readonly workspaceContextService: IWorkspaceContextService;
	readonly workspacesService: IWorkspacesService;
};

/**
 * PositronReactServicesContext. This context provides access to the Positron React services.
 */
export const PositronReactServicesContext = createContext<PositronReactServices>(undefined!);

/**
 * usePositronReactServicesContext hook. This hook provides access to the Positron React services context.
 * @returns The Positron React services context.
 */
export const usePositronReactServicesContext = () => useContext(PositronReactServicesContext);
