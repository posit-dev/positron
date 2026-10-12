/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useState } from 'react';

// Other dependencies.
import { NewFolderFlowContextProvider, useNewFolderFlowContext } from './newFolderFlowContext.js';
import { NewFolderFlowState } from './newFolderFlowState.js';
import { NewFolderFlowStepContainer } from './newFolderFlowStepContainer.js';
import { FlowDialogProvider } from './components/flowStep.js';
import { NewFolderConfiguration } from '../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowStep } from './interfaces/newFolderFlowEnums.js';
import { showChooseNewFolderWindowModalDialog } from './chooseNewFolderWindowModalDialog.js';
import { URI } from '../../../base/common/uri.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { acceptNewFolderFlow, createNewFolderFlowDialogHandlers } from './utilities/acceptNewFolderFlow.js';

/**
 * Shows the NewFolderFlowModalDialog.
 */
export const showNewFolderFlowModalDialog = async (): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Show the new folder flow modal dialog.
	renderer.render(
		<NewFolderFlowContextProvider
			initialStep={NewFolderFlowStep.FolderTemplateSelection}
			parentFolder={await renderer.services.fileDialogService.defaultFolderPath()}
		>
			<NewFolderFlowModalDialog
				renderer={renderer}
				setUpFolder={async (result, folder, existingFolder) => {
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
							try {
								await renderer.services.commandService.executeCommand(
									'python.installIpykernel',
									String(pythonPath)
								);
							} catch (err) {
								renderer.services.logService.warn(
									'Could not install ipykernel via New Folder Flow; the runtime will prompt again',
									err
								);
							}
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
			/>
		</NewFolderFlowContextProvider>
	);
};

/**
 * NewFolderFlowModalDialogProps interface.
 */
interface NewFolderFlowModalDialogProps {
	renderer: PositronModalReactRenderer;
	setUpFolder: (result: NewFolderFlowState, folder: URI, existingFolder: boolean) => Promise<void>;
}

/**
 * NewFolderFlowModalDialog component.
 * @param props The component properties.
 * @returns The rendered component.
 */
const NewFolderFlowModalDialog = (props: NewFolderFlowModalDialogProps) => {
	// State.
	const context = useNewFolderFlowContext();

	// The accept and cancel handlers, created once so that their in-flight and closed flags
	// survive re-renders.
	const [handlers] = useState(() => createNewFolderFlowDialogHandlers(
		() => acceptNewFolderFlow(
			context,
			props.renderer.services,
			() => props.renderer.dispose(),
			props.setUpFolder
		),
		() => props.renderer.dispose()
	));

	// Render. Each step renders its own dialog, sized to the step's content.
	return (
		<FlowDialogProvider
			dialog={{
				renderer: props.renderer,
				onCancel: handlers.cancel,
			}}
		>
			<NewFolderFlowStepContainer accept={handlers.accept} cancel={handlers.cancel} />
		</FlowDialogProvider>
	);
};
