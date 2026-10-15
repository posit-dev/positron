/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useRef } from 'react';

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
import { localize } from '../../../nls.js';
import { isCancellationError } from '../../../base/common/errors.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { createFolderErrorMessage } from '../utils/createFolder.js';

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
				createFolder={async result => {
					// Create the new folder if it doesn't already exist. The Folder Name and
					// Location step already checked that the folder can be created, so a failure
					// here is rare.
					const folder = URI.joinPath(result.parentFolder, result.folderName);
					let existingFolder: boolean;
					try {
						existingFolder = await renderer.services.fileService.exists(folder);
						if (!existingFolder) {
							await renderer.services.fileService.createFolder(folder);
						}
					} catch (err) {
						renderer.services.logService.error('New Folder Flow: could not create the folder', err);
						renderer.services.notificationService.error(createFolderErrorMessage(err));
						return;
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

	// Set when the dialog closes. Create on the Empty Project step checks the location before it
	// accepts, so the user can cancel in between; a late accept must not create the folder.
	const closed = useRef(false);

	// The accept handler.
	const acceptHandler = async () => {
		if (closed.current) {
			return;
		}
		closed.current = true;
		const state = context.getState();
		props.renderer.dispose();
		try {
			await props.createFolder(state);
		} catch (err) {
			// Opening the folder in this window may cancel the pending call as the window shuts
			// down; that is not a failure.
			if (isCancellationError(err)) {
				return;
			}
			props.renderer.services.logService.error('New Folder Flow: could not set up the new folder', err);
			props.renderer.services.notificationService.error(localize(
				'positron.newFolderFlow.setUpFolderFailed',
				"Could not set up the new folder '{0}': {1}",
				state.folderName, toErrorMessage(err)
			));
		}
	};

	// The cancel handler.
	const cancelHandler = () => {
		closed.current = true;
		props.renderer.dispose();
	};

	// Render. Each step renders its own dialog, sized to the step's content.
	return (
		<FlowDialogProvider
			dialog={{
				renderer: props.renderer,
				onCancel: cancelHandler,
			}}
		>
			<NewFolderFlowStepContainer accept={acceptHandler} cancel={cancelHandler} />
		</FlowDialogProvider>
	);
};
