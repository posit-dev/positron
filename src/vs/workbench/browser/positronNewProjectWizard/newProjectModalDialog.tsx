/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { NewProjectWizardContextProvider, useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { NewProjectWizardState } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardState';
import { NewProjectWizardStepContainer } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardStepContainer';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { URI } from 'vs/base/common/uri';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPositronNewProjectService, NewProjectConfiguration } from 'vs/workbench/services/positronNewProject/common/positronNewProject';
import { EnvironmentSetupType, NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';

/**
 * Shows the NewProjectModalDialog.
 */
export const showNewProjectModalDialog = async (
	commandService: ICommandService,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	keybindingService: IKeybindingService,
	languageRuntimeService: ILanguageRuntimeService,
	layoutService: IWorkbenchLayoutService,
	logService: ILogService,
	openerService: IOpenerService,
	pathService: IPathService,
	positronNewProjectService: IPositronNewProjectService,
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
	workspaceTrustManagementService: IWorkspaceTrustManagementService
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
			services={{
				commandService,
				fileDialogService,
				fileService,
				keybindingService,
				languageRuntimeService,
				layoutService,
				logService,
				openerService,
				pathService,
				runtimeSessionService,
				runtimeStartupService,
			}}
			parentFolder={(await fileDialogService.defaultFolderPath()).fsPath}
			initialStep={NewProjectWizardStep.ProjectTypeSelection}
		>
			<NewProjectModalDialog
				renderer={renderer}
				createProject={async result => {
					// Create the new project folder if it doesn't already exist.
					const folder = URI.file((await pathService.path).join(result.parentFolder, result.projectName));
					const existingFolder = await fileService.exists(folder);
					if (!existingFolder) {
						await fileService.createFolder(folder);
					}

					// The python environment type is only relevant if a new environment is being created.
					const pythonEnvType =
						result.pythonEnvSetupType === EnvironmentSetupType.NewEnvironment
							? result.pythonEnvProviderId
							: '';

					// Install ipykernel if applicable.
					if (result.installIpykernel) {
						const pythonPath =
							result.selectedRuntime?.extraRuntimeData?.pythonPath ??
							result.selectedRuntime?.runtimePath ??
							'';
						if (!pythonPath) {
							logService.error('Could not determine python path to install ipykernel via Positron Project Wizard');
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
						runtimeMetadata: result.selectedRuntime || undefined,
						projectType: result.projectType || '',
						projectFolder: folder.fsPath,
						projectName: result.projectName,
						initGitRepo: result.initGitRepo,
						pythonEnvType: pythonEnvType || '',
						installIpykernel: result.installIpykernel || false,
						useRenv: result.useRenv || false,
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
					await commandService.executeCommand(
						'vscode.openFolder',
						folder,
						{
							forceNewWindow: result.openInNewWindow,
							forceReuseWindow: !result.openInNewWindow
						}
					);
				}}
			/>
		</NewProjectWizardContextProvider>
	);
};

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
			renderer={props.renderer}
			width={700} height={520}
			title={(() => localize('positronNewProjectWizard.title', "Create New Project"))()}
			onAccept={acceptHandler}
			onCancel={cancelHandler}
		>
			<NewProjectWizardStepContainer cancel={cancelHandler} accept={acceptHandler} />
		</PositronModalDialog>
	);
};
