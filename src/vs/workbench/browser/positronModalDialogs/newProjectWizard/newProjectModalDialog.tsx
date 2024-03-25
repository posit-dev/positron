/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newProjectModalDialog';
const React = require('react');
import { localize } from 'vs/nls';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { NewProjectWizardContextProvider } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { NewProjectConfiguration, NewProjectWizardServices } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardState';
import { NewProjectWizardStepContainer } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardStepContainer';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';
import { PositronModalDialog } from 'vs/workbench/browser/positronComponents/positronModalDialog/positronModalDialog';
import { URI } from 'vs/base/common/uri';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IFileService } from 'vs/platform/files/common/files';
import { ICommandService } from 'vs/platform/commands/common/commands';

/**
 * Shows the NewProjectModalDialog.
 */
export const showNewProjectModalDialog = async (
	fileDialogService: IFileDialogService,
	languageRuntimeService: ILanguageRuntimeService,
	runtimeSessionService: IRuntimeSessionService,
	runtimeStartupService: IRuntimeStartupService,
	layoutService: IWorkbenchLayoutService,
	keybindingService: IKeybindingService,
	pathService: IPathService,
	fileService: IFileService,
	commandService: ICommandService,
): Promise<void> => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer({
		keybindingService,
		layoutService,
		container: layoutService.activeContainer
	});

	// Show the new project modal dialog.
	renderer.render(
		<NewProjectModalDialog
			services={{
				fileDialogService,
				languageRuntimeService,
				runtimeSessionService,
				runtimeStartupService,
				layoutService,
				keybindingService
			}}
			renderer={renderer}
			parentFolder={(await fileDialogService.defaultFolderPath()).fsPath}
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
	);
};


interface NewProjectModalDialogProps {
	services: NewProjectWizardServices;
	renderer: PositronModalReactRenderer;
	parentFolder: string;
	createProject: (result: NewProjectConfiguration) => Promise<void>;
}

/**
 * NewProjectModalDialog component.
 * @returns The rendered component.
 */
const NewProjectModalDialog = (props: NewProjectModalDialogProps) => {
	// The accept handler. This is called when the user clicks the Create button in the wizard.
	const acceptHandler = async (projectConfig: NewProjectConfiguration) => {
		props.renderer.dispose();
		await props.createProject(projectConfig);
		// TODO: how to return project config and do project creation?
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
			// TODO: get accept handler working. The current issue is that the accept handler
			// does not take arguments, and we need the projectConfig from the wizard context,
			// which we pass from the step container to this component upon clicking the Create
			// button in the wizard. But if the user hits the Enter key, the accept handler is
			// called without the projectConfig. Is there a way to listen for the Enter key press
			// directly on the Ok button?
			// onAccept={acceptHandler}
			onAccept={() => null}
			onCancel={cancelHandler}
		>
			<NewProjectWizardContextProvider services={props.services} parentFolder={props.parentFolder}>
				<NewProjectWizardStepContainer cancel={cancelHandler} accept={acceptHandler} />
			</NewProjectWizardContextProvider>
		</PositronModalDialog>
	);
};
