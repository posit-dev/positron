/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from 'vs/nls';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { NewProjectWizardContextProvider, useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardState';
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
	pathService: IPathService,
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
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
				fileDialogService,
				keybindingService,
				languageRuntimeService,
				layoutService,
				logService,
				runtimeSessionService,
				runtimeStartupService,
			}}
			parentFolder={(await fileDialogService.defaultFolderPath()).fsPath}
		>
			<NewProjectModalDialog
				renderer={renderer}
				createProject={async result => {
					// Create the new project.
					const folder = URI.file((await pathService.path).join(result.parentFolder, result.projectName));
					if (!(await fileService.exists(folder))) {
						await fileService.createFolder(folder);
					}
					await commandService.executeCommand(
						'vscode.openFolder',
						folder,
						{
							forceNewWindow: result.openInNewWindow,
							forceReuseWindow: !result.openInNewWindow
						}
					);

					// TODO: whether the folder is opened in a new window or not, we will need to store the
					// project configuration in some workspace state so that we can use it to start the runtime.
					// The extension host gets destroyed when a new project is opened in the same window.
					//   - Where can the new project config be stored?
					//       - See IStorageService, maybe StorageScope.WORKSPACE and StorageTarget.MACHINE

					// 1) Create the directory for the new project (done above)
					// 2) Set up the initial workspace for the new project
					//   For Python
					//     - If new environment creation is selected, create the .venv/.conda/etc. as appropriate
					//     - If git init selected, create the .gitignore and README.md
					//     - Create an unsaved Python file
					//     - Set the active interpreter to the selected interpreter
					//   For R
					//     - If renv selected, run renv::init()
					//     - Whether or not git init selected, create the .gitignore and README.md
					//     - Create an unsaved R file
					//     - Set the active interpreter to the selected interpreter
					//   For Jupyter Notebook
					//     - If git init selected, create the .gitignore and README.md
					//     - Create an unsaved notebook file
					//     - Set the active interpreter to the selected interpreter

					// Other Thoughts
					//   - Can the interpreter discovery at startup be modified to directly use the selected
					//     interpreter, so that the user doesn't have to wait for the interpreter discovery to
					//     complete before the runtime is started?
				}}
			/>
		</NewProjectWizardContextProvider>
	);
};

interface NewProjectModalDialogProps {
	renderer: PositronModalReactRenderer;
	createProject: (result: NewProjectConfiguration) => Promise<void>;
}

/**
 * NewProjectModalDialog component.
 * @returns The rendered component.
 */
const NewProjectModalDialog = (props: NewProjectModalDialogProps) => {
	const projectState = useNewProjectWizardContext();

	// The accept handler.
	const acceptHandler = async () => {
		props.renderer.dispose();
		await props.createProject(projectState.projectConfig);
	};

	// The cancel handler.
	const cancelHandler = () => {
		props.renderer.dispose();
	};

	// Render.
	return (
		<PositronModalDialog
			renderer={props.renderer}
			width={700} height={500}
			title={localize('positronNewProjectWizard.title', "Create New Project")}
			onAccept={acceptHandler}
			onCancel={cancelHandler}
		>
			<NewProjectWizardStepContainer cancel={cancelHandler} accept={acceptHandler} />
		</PositronModalDialog>
	);
};
