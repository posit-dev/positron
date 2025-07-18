/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/log.js';
import { IFileService } from '../../platform/files/common/files.js';
import { ILabelService } from '../../platform/label/common/label.js';
import { IModelService } from '../../editor/common/services/model.js';
import { IHoverService } from '../../platform/hover/browser/hover.js';
import { IOpenerService } from '../../platform/opener/common/opener.js';
import { IViewDescriptorService } from '../../workbench/common/views.js';
import { IThemeService } from '../../platform/theme/common/themeService.js';
import { ICommandService } from '../../platform/commands/common/commands.js';
import { ILanguageService } from '../../editor/common/languages/language.js';
import { IHostService } from '../../workbench/services/host/browser/host.js';
import { IFileDialogService } from '../../platform/dialogs/common/dialogs.js';
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
import { IWorkspaceTrustManagementService } from '../../platform/workspace/common/workspaceTrust.js';
import { IPositronPlotsService } from '../../workbench/services/positronPlots/common/positronPlots.js';
import { IPositronHelpService } from '../../workbench/contrib/positronHelp/browser/positronHelpService.js';
import { IRuntimeSessionService } from '../../workbench/services/runtimeSession/common/runtimeSessionService.js';
import { IWorkbenchEnvironmentService } from '../../workbench/services/environment/common/environmentService.js';
import { IRuntimeStartupService } from '../../workbench/services/runtimeStartup/common/runtimeStartupService.js';
import { IPositronPreviewService } from '../../workbench/contrib/positronPreview/browser/positronPreviewSevice.js';
import { IPositronNewFolderService } from '../../workbench/services/positronNewFolder/common/positronNewFolder.js';
import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { IExecutionHistoryService } from '../../workbench/services/positronHistory/common/executionHistoryService.js';
import { IPositronModalDialogsService } from '../../workbench/services/positronModalDialogs/common/positronModalDialogs.js';
import { IPositronConsoleService } from '../../workbench/services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronAssistantService } from '../../workbench/contrib/positronAssistant/common/interfaces/positronAssistantService.js';
import { IPositronTopActionBarService } from '../../workbench/services/positronTopActionBar/browser/positronTopActionBarService.js';
import { IPositronVariablesService } from '../../workbench/services/positronVariables/common/interfaces/positronVariablesService.js';
import { IPositronConnectionsService } from '../../workbench/services/positronConnections/common/interfaces/positronConnectionsService.js';
import { IPositronWebviewPreloadService } from '../../workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { IPositronNotebookOutputWebviewService } from '../../workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IPositronDataExplorerService } from '../../workbench/services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';

/**
 * PositronReactServices interface.
 */
export class PositronReactServices {
	/**
	 * The singleton instance of PositronReactServices.
	 */
	public static services: PositronReactServices;

	/**
	 * Initializes the PositronReactServices.
	 * @param instantiationService The instantiation service used to create instances of services.
	 */
	static initialize(instantiationService: IInstantiationService) {
		if (!PositronReactServices.services) {
			PositronReactServices.services = instantiationService.createInstance(PositronReactServices);
		}
	}

	/**
	 * Constructor for PositronReactServices.
	 */
	public constructor(
		@IAccessibilityService public readonly accessibilityService: IAccessibilityService,
		@IClipboardService public readonly clipboardService: IClipboardService,
		@ICommandService public readonly commandService: ICommandService,
		@IConfigurationService public readonly configurationService: IConfigurationService,
		@IContextKeyService public readonly contextKeyService: IContextKeyService,
		@IContextMenuService public readonly contextMenuService: IContextMenuService,
		@IEditorService public readonly editorService: IEditorService,
		@IExecutionHistoryService public readonly executionHistoryService: IExecutionHistoryService,
		@IFileService public readonly fileService: IFileService,
		@IFileDialogService public readonly fileDialogService: IFileDialogService,
		@IHoverService public readonly hoverService: IHoverService,
		@IHostService public readonly hostService: IHostService,
		@IInstantiationService public readonly instantiationService: IInstantiationService,
		@IKeybindingService public readonly keybindingService: IKeybindingService,
		@ILabelService public readonly labelService: ILabelService,
		@ILanguageModelsService public readonly languageModelsService: ILanguageModelsService,
		@ILanguageRuntimeService public readonly languageRuntimeService: ILanguageRuntimeService,
		@ILanguageService public readonly languageService: ILanguageService,
		@ILogService public readonly logService: ILogService,
		@IModelService public readonly modelService: IModelService,
		@INotificationService public readonly notificationService: INotificationService,
		@IOpenerService public readonly openerService: IOpenerService,
		@IPathService public readonly pathService: IPathService,
		@IPositronAssistantService public readonly positronAssistantService: IPositronAssistantService,
		@IPositronConnectionsService public readonly positronConnectionsService: IPositronConnectionsService,
		@IPositronConsoleService public readonly positronConsoleService: IPositronConsoleService,
		@IPositronDataExplorerService public readonly positronDataExplorerService: IPositronDataExplorerService,
		@IPositronHelpService public readonly positronHelpService: IPositronHelpService,
		@IPositronModalDialogsService public readonly positronModalDialogsService: IPositronModalDialogsService,
		@IPositronNewFolderService public readonly positronNewFolderService: IPositronNewFolderService,
		@IPositronNotebookOutputWebviewService public readonly positronNotebookOutputWebviewService: IPositronNotebookOutputWebviewService,
		@IPositronPlotsService public readonly positronPlotsService: IPositronPlotsService,
		@IPositronPreviewService public readonly positronPreviewService: IPositronPreviewService,
		@IPositronTopActionBarService public readonly positronTopActionBarService: IPositronTopActionBarService,
		@IPositronVariablesService public readonly positronVariablesService: IPositronVariablesService,
		@IPositronWebviewPreloadService public readonly positronWebviewPreloadService: IPositronWebviewPreloadService,
		@IPreferencesService public readonly preferencesService: IPreferencesService,
		@IQuickInputService public readonly quickInputService: IQuickInputService,
		@IRuntimeSessionService public readonly runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService public readonly runtimeStartupService: IRuntimeStartupService,
		@ITextModelService public readonly textModelService: ITextModelService,
		@IThemeService public readonly themeService: IThemeService,
		@IViewDescriptorService public readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService public readonly viewsService: IViewsService,
		@IWebviewService public readonly webviewService: IWebviewService,
		@IWorkbenchEnvironmentService public readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IWorkbenchLayoutService public readonly workbenchLayoutService: IWorkbenchLayoutService,
		@IWorkspaceContextService public readonly workspaceContextService: IWorkspaceContextService,
		@IWorkspacesService public readonly workspacesService: IWorkspacesService,
		@IWorkspaceTrustManagementService public readonly workspaceTrustManagementService: IWorkspaceTrustManagementService
	) { }
}
