/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { NewFolderFlowContextProvider, useNewFolderFlowContext } from './newFolderFlowContext.js';
import { ILanguageRuntimeService } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { NewFolderFlowState } from './newFolderFlowState.js';
import { NewFolderFlowStepContainer } from './newFolderFlowStepContainer.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { PositronModalReactRenderer } from '../positronModalReactRenderer/positronModalReactRenderer.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IPositronNewFolderService, NewFolderConfiguration } from '../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowStep } from './interfaces/newFolderFlowEnums.js';
import { IWorkspaceTrustManagementService } from '../../../platform/workspace/common/workspaceTrust.js';
import { showChooseNewFolderWindowModalDialog } from './chooseNewFolderWindowModalDialog.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { URI } from '../../../base/common/uri.js';
import { ILabelService } from '../../../platform/label/common/label.js';

/**
 * Shows the NewFolderFlowModalDialog.
 */
export const showNewFolderFlowModalDialog = async (
	commandService: ICommandService,
	configurationService: IConfigurationService,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	keybindingService: IKeybindingService,
	labelService: ILabelService,
	languageRuntimeService: ILanguageRuntimeService,
	layoutService: IWorkbenchLayoutService,
	logService: ILogService,
	openerService: IOpenerService,
	pathService: IPathService,
	positronNewFolderService: IPositronNewFolderService,
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
	workspaceTrustManagementService: IWorkspaceTrustManagementService,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the new folder flow modal dialog.
	renderer.render(
		<NewFolderFlowContextProvider
			initialStep={NewFolderFlowStep.FolderTemplateSelection}
			parentFolder={await fileDialogService.defaultFolderPath()}
			services={{
				commandService,
				configurationService,
				fileDialogService,
				fileService,
				keybindingService,
				labelService,
				languageRuntimeService,
				layoutService,
				logService,
				openerService,
				pathService,
				runtimeSessionService,
				runtimeStartupService,
			}}
		>
			<NewFolderFlowModalDialog
				createFolder={async result => {
					// Create the new folder if it doesn't already exist.
					const folder = URI.joinPath(result.parentFolder, result.folderName);
					const existingFolder = await fileService.exists(folder);
					if (!existingFolder) {
						await fileService.createFolder(folder);
					}

					// Install ipykernel if applicable.
					if (result.installIpykernel) {
						const pythonPath =
							result.selectedRuntime?.extraRuntimeData
								?.pythonPath ??
							result.selectedRuntime?.runtimePath ??
							undefined;
						if (!pythonPath) {
							logService.error(
								'Could not determine python path to install ipykernel via New Folder Flow'
							);
						} else {
							// Awaiting the command execution is necessary to ensure ipykernel is
							// installed before the folder is opened.
							// If an error occurs while installing ipykernel, a message will be
							// logged and once the folder is opened, when the chosen runtime is
							// starting, the user will be prompted again to install ipykernel.
							await commandService.executeCommand(
								'python.installIpykernel',
								String(pythonPath)
							);
						}
					}

					// Create the new folder configuration.
					const newFolderConfig: NewFolderConfiguration = {
						folderScheme: folder.scheme,
						folderAuthority: folder.authority,
						runtimeMetadata: result.selectedRuntime || undefined,
						folderTemplate: result.folderTemplate || '',
						folderPath: folder.path,
						folderName: result.folderName,
						initGitRepo: result.initGitRepo,
						pythonEnvProviderId: result.pythonEnvProviderId,
						pythonEnvProviderName: result.pythonEnvProviderName,
						installIpykernel: result.installIpykernel,
						condaPythonVersion: result.condaPythonVersion,
						uvPythonVersion: result.uvPythonVersion,
						useRenv: result.useRenv,
					};

					// TODO: we may want to allow the user to select an already existing folder
					// and then create the folder in that folder. We will need to handle if the
					// folder is the same as the current workspace folder in the active window
					// or if the new folder directory is already open in another window.

					// Store the new folder configuration.
					positronNewFolderService.storeNewFolderConfig(newFolderConfig);

					// If the folder is new, set its trust state to trusted.
					if (!existingFolder) {
						workspaceTrustManagementService.setUrisTrust([folder], true);
					}

					// Any context-dependent work needs to be done before opening the folder
					// because the extension host gets destroyed when a new folder is opened,
					// whether the folder is opened in a new window or in the existing window.
					// Ask the user where to open the new folder and open it.
					showChooseNewFolderWindowModalDialog(
						commandService,
						keybindingService,
						layoutService,
						folder.path,
						folder,
						result.openInNewWindow
					);
				}}
				renderer={renderer}
			/>
		</NewFolderFlowContextProvider>
	);
};

/**
 * NewFolderFlowModalDialogProps interface.
 */
interface NewFolderFlowModalDialogProps {
	renderer: PositronModalReactRenderer;
	createFolder: (result: NewFolderFlowState) => Promise<void>;
}

/**
 * NewFolderFlowModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const NewFolderFlowModalDialog = (props: NewFolderFlowModalDialogProps) => {
	// State.
	const context = useNewFolderFlowContext();

	// The accept handler.
	const acceptHandler = async () => {
		props.renderer.dispose();
		await props.createFolder(context.getState());
	};

	// The cancel handler.
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	// Render.
	return (
		<PositronModalDialog
			height={520}
			renderer={props.renderer} title={(() => localize('positron.newFolderFromTemplate', "New Folder From Template"))()}
			width={700}
			onCancel={cancelHandler}
		>
			<NewFolderFlowStepContainer accept={acceptHandler} cancel={cancelHandler} />
		</PositronModalDialog>
	);
};
