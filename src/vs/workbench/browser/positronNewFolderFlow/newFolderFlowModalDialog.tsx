/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { NewFolderFlowContextProvider, useNewFolderFlowContext } from './newFolderFlowContext.js';
import { NewFolderFlowState } from './newFolderFlowState.js';
import { NewFolderFlowStepContainer } from './newFolderFlowStepContainer.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { NewFolderConfiguration } from '../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowStep } from './interfaces/newFolderFlowEnums.js';
import { showChooseNewFolderWindowModalDialog } from './chooseNewFolderWindowModalDialog.js';
import { URI } from '../../../base/common/uri.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';

/**
 * Shows the NewFolderFlowModalDialog.
 */
export const showNewFolderFlowModalDialog = async (): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer()

	// Show the new folder flow modal dialog.
	renderer.render(
		<NewFolderFlowContextProvider
			initialStep={NewFolderFlowStep.FolderTemplateSelection}
			parentFolder={await renderer.services.fileDialogService.defaultFolderPath()}
		>
			<NewFolderFlowModalDialog
				createFolder={async result => {
					// Create the new folder if it doesn't already exist.
					const folder = URI.joinPath(result.parentFolder, result.folderName);
					const existingFolder = await renderer.services.fileService.exists(folder);
					if (!existingFolder) {
						await renderer.services.fileService.createFolder(folder);
					}

					// Install ipykernel if applicable.
					if (result.installIpykernel) {
						const pythonPath =
							result.selectedRuntime?.extraRuntimeData
								?.pythonPath ??
							result.selectedRuntime?.runtimePath ??
							undefined;
						if (!pythonPath) {
							renderer.services.logService.error(
								'Could not determine python path to install ipykernel via New Folder Flow'
							);
						} else {
							// Awaiting the command execution is necessary to ensure ipykernel is
							// installed before the folder is opened.
							// If an error occurs while installing ipykernel, a message will be
							// logged and once the folder is opened, when the chosen runtime is
							// starting, the user will be prompted again to install ipykernel.
							await renderer.services.commandService.executeCommand(
								'python.installIpykernel',
								String(pythonPath)
							);
						}
					}

					// TODO: we may want to allow the user to select an already existing folder
					// and then create the folder in that folder. We will need to handle if the
					// folder is the same as the current workspace folder in the active window
					// or if the new folder directory is already open in another window.

					// If the folder is new, set its trust state to trusted.
					if (!existingFolder) {
						renderer.services.workspaceTrustManagementService.setUrisTrust([folder], true);
					}

					// Ask the user where to open the new folder.
					result.openInNewWindow = await showChooseNewFolderWindowModalDialog(
						folder.path,
						result.openInNewWindow,
					);

					// Create the new folder configuration.
					const newFolderConfig: NewFolderConfiguration = {
						folderScheme: folder.scheme,
						folderAuthority: folder.authority,
						runtimeMetadata: result.selectedRuntime || undefined,
						folderTemplate: result.folderTemplate || '',
						folderPath: folder.path,
						folderName: result.folderName,
						initGitRepo: result.initGitRepo,
						createPyprojectToml: result.createPyprojectToml,
						pythonEnvProviderId: result.pythonEnvProviderId,
						pythonEnvProviderName: result.pythonEnvProviderName,
						pythonEnvName: result.pythonEnvName,
						installIpykernel: result.installIpykernel,
						condaPythonVersion: result.condaPythonVersion,
						uvPythonVersion: result.uvPythonVersion,
						useRenv: result.useRenv,
						openInNewWindow: result.openInNewWindow,
					};

					// Store the new folder configuration.
					renderer.services.positronNewFolderService.storeNewFolderConfig(newFolderConfig);

					// Any context-dependent work needs to be done before opening the folder
					// because the extension host gets destroyed when a new folder is opened,
					// whether the folder is opened in a new window or in the existing window.
					// Open the folder in the selected window.
					await renderer.services.commandService.executeCommand(
						'vscode.openFolder',
						folder,
						{
							forceNewWindow: result.openInNewWindow,
							forceReuseWindow: !result.openInNewWindow
						}
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
