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
import { NewProjectWizardContextProvider, useNewProjectWizardContext } from './newProjectWizardContext.js';
import { ILanguageRuntimeService } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { NewProjectWizardState } from './newProjectWizardState.js';
import { NewProjectWizardStepContainer } from './newProjectWizardStepContainer.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { PositronModalReactRenderer } from '../positronModalReactRenderer/positronModalReactRenderer.js';
import { PositronModalDialog } from '../positronComponents/positronModalDialog/positronModalDialog.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IPositronNewProjectService, NewProjectConfiguration } from '../../services/positronNewProject/common/positronNewProject.js';
import { NewProjectWizardStep } from './interfaces/newProjectWizardEnums.js';
import { IWorkspaceTrustManagementService } from '../../../platform/workspace/common/workspaceTrust.js';
import { showChooseNewProjectWindowModalDialog } from './chooseNewProjectWindowModalDialog.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { URI } from '../../../base/common/uri.js';
import { ILabelService } from '../../../platform/label/common/label.js';

/**
 * Shows the NewProjectModalDialog.
 */
export const showNewProjectModalDialog = async (
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
	positronNewProjectService: IPositronNewProjectService,
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

	// Show the new project modal dialog.
	renderer.render(
		<NewProjectWizardContextProvider
			initialStep={NewProjectWizardStep.ProjectTypeSelection}
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
			<NewProjectModalDialog
				createProject={async result => {
					// Create the new project folder if it doesn't already exist.
					const folder = URI.joinPath(result.parentFolder, result.projectName);
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
								'Could not determine python path to install ipykernel via Positron Project Wizard'
							);
						} else {
							// Awaiting the command execution is necessary to ensure ipykernel is
							// installed before the project is opened.
							// If an error occurs while installing ipykernel, a message will be
							// logged and once the project is opened, when the chosen runtime is
							// starting, the user will be prompted again to install ipykernel.
							await commandService.executeCommand(
								'python.installIpykernel',
								String(pythonPath)
							);
						}
					}

					// Create the new project configuration.
					const newProjectConfig: NewProjectConfiguration = {
						folderScheme: folder.scheme,
						folderAuthority: folder.authority,
						runtimeMetadata: result.selectedRuntime || undefined,
						projectType: result.projectType || '',
						projectFolder: folder.path,
						projectName: result.projectName,
						initGitRepo: result.initGitRepo,
						pythonEnvProviderId: result.pythonEnvProviderId,
						pythonEnvProviderName: result.pythonEnvProviderName,
						installIpykernel: result.installIpykernel,
						condaPythonVersion: result.condaPythonVersion,
						useRenv: result.useRenv,
					};

					// TODO: we may want to allow the user to select an already existing directory
					// and then create the project in that directory. We will need to handle if the
					// directory is the same as the current workspace directory in the active window
					// or if the new project directory is already open in another window.

					// Store the new project configuration.
					positronNewProjectService.storeNewProjectConfig(newProjectConfig);

					// If the folder is new, set its trust state to trusted.
					if (!existingFolder) {
						workspaceTrustManagementService.setUrisTrust([folder], true);
					}

					// Any context-dependent work needs to be done before opening the folder
					// because the extension host gets destroyed when a new project is opened,
					// whether the folder is opened in a new window or in the existing window.
					// Ask the user where to open the new project and open it.
					showChooseNewProjectWindowModalDialog(
						commandService,
						keybindingService,
						layoutService,
						result.projectName,
						folder,
						result.openInNewWindow
					);
				}}
				renderer={renderer}
			/>
		</NewProjectWizardContextProvider>
	);
};

/**
 * NewProjectModalDialogProps interface.
 */
interface NewProjectModalDialogProps {
	renderer: PositronModalReactRenderer;
	createProject: (result: NewProjectWizardState) => Promise<void>;
}

/**
 * NewProjectModalDialog component.
 * @returns The rendered component.
 */
const NewProjectModalDialog = (props: NewProjectModalDialogProps) => {
	// State.
	const context = useNewProjectWizardContext();

	// The accept handler.
	const acceptHandler = async () => {
		props.renderer.dispose();
		await props.createProject(context.getState());
	};

	// The cancel handler.
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	// Render.
	return (
		<PositronModalDialog
			height={520}
			renderer={props.renderer} title={(() => localize('positronNewProjectWizard.title', "Create New Project"))()}
			width={700}
			onCancel={cancelHandler}
		>
			<NewProjectWizardStepContainer accept={acceptHandler} cancel={cancelHandler} />
		</PositronModalDialog>
	);
};
