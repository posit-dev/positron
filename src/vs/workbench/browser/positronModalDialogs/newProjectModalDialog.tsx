/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newProjectModalDialog';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { Checkbox } from 'vs/base/browser/ui/positronModalDialog/components/checkbox';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { PositronWizardStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardStep';
import { PositronWizardSubStep } from 'vs/base/browser/ui/positronModalDialog/components/wizardSubStep';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * NewProjectResult interface.
 */
export interface NewProjectResult {
	readonly projectType: string;
	readonly projectName: string;
	readonly parentFolder: string;
	readonly initGitRepo: boolean;
	readonly inheritDeps: boolean;
	readonly installIpykernel: boolean;
	readonly newWindow: boolean;
}

/**
 * Shows the NewProjectModalDialog.
 * @param accessor The services accessor.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showNewProjectModalDialog = async (accessor: ServicesAccessor): Promise<NewProjectResult | undefined> => {
	// Get the services we need for the dialog.
	const fileDialogs = accessor.get(IFileDialogService);
	const layoutService = accessor.get(IWorkbenchLayoutService);

	// Load data we need to present the dialog.
	const parentFolder = (await fileDialogs.defaultFolderPath()).fsPath;

	// Return a promise that resolves when the dialog is done.
	return new Promise<NewProjectResult | undefined>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer =
			new PositronModalReactRenderer(layoutService.mainContainer);

		// The new project modal dialog component.
		const NewProjectModalDialog = () => {
			// Hooks.
			const [newProjectResult, setNewProjectResult, newProjectResultRef] = useStateRef<NewProjectResult>({
				projectType: 'Python Project',
				projectName: 'myPythonProject',
				parentFolder,
				initGitRepo: false,
				inheritDeps: false,
				installIpykernel: true,
				newWindow: false
			});
			const projectNameRef = useRef<HTMLInputElement>(undefined!);
			const [currentStep, setCurrentStep] = useState(0);
			const totalSteps = 3;
			const okButtonTitle = localize('positronNewProjectModalDialogCreateButtonTitle', "Create");

			// The accept handler.
			const acceptHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(newProjectResultRef.current);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			// QUESTION: what about non-linear wizard steps where the next step isn't currentStep+1?
			// The back handler.
			const backHandler = () => {
				if (currentStep > 0) {
					setCurrentStep(currentStep - 1);
				}
				positronModalReactRenderer.render(<NewProjectModalDialog />);
			};

			// The next handler.
			const nextHandler = () => {
				if (currentStep < totalSteps - 1) {
					setCurrentStep(currentStep + 1);
				}
				positronModalReactRenderer.render(<NewProjectModalDialog />);
			};

			// The browse handler.
			const browseHandler = async () => {
				// Show the open dialog.
				const uri = await fileDialogs.showOpenDialog({
					defaultUri: newProjectResult.parentFolder ? URI.file(newProjectResult.parentFolder) : undefined,
					canSelectFiles: false,
					canSelectFolders: true
				});

				// If the user made a selection, set the parent directory.
				if (uri?.length) {
					setNewProjectResult({ ...newProjectResult, parentFolder: uri[0].fsPath });
					projectNameRef.current.focus();
				}
			};

			// Render.
			return (
				<PositronModalDialog
					renderer={positronModalReactRenderer}
					width={700} height={500}
					title={localize('positronNewProjectModalDialogTitle', "Create New Project")}
				>
					{currentStep === 0 && (
						<PositronWizardStep
							title='Project Type'
							currentStep={currentStep}
							totalSteps={totalSteps}
							okButtonTitle={okButtonTitle}
							accept={acceptHandler}
							cancel={cancelHandler}
							back={backHandler}
							next={nextHandler}
						>
							<PositronWizardSubStep title='Select the type of project to create.'>
								<div className='project-type-grid'>
									<Button className='project-type-button'>
										Python Project
									</Button>
									<Button className='project-type-button'>
										Jupyter Notebook
									</Button>
									<Button className='project-type-button'>
										R Project
									</Button>
								</div>
							</PositronWizardSubStep>
						</PositronWizardStep>
					)}
					{currentStep === 1 && (
						<PositronWizardStep
							title='Set project name and location'
							currentStep={currentStep}
							totalSteps={totalSteps}
							okButtonTitle={okButtonTitle}
							accept={acceptHandler}
							cancel={cancelHandler}
							back={backHandler}
							next={nextHandler}
						>
							<PositronWizardSubStep
								title='Project Name'
							// description={'Enter a name for your new ' + newProjectResult.projectType}
							>
								<LabeledTextInput
									ref={projectNameRef}
									label={`Enter a name for your new ${newProjectResult.projectType}`}
									autoFocus
									value={newProjectResult.projectName}
									onChange={e => setNewProjectResult({ ...newProjectResult, projectName: e.target.value })}
								/>
							</PositronWizardSubStep>
							<PositronWizardSubStep
								title='Parent Directory'
								// description='Select a directory to create your project in.'
								feedback={'Your project will be created at: ' + newProjectResult.parentFolder + '/' + newProjectResult.projectName}
							>
								<LabeledFolderInput
									label='Select a directory to create your project in'
									value={newProjectResult.parentFolder} // this should be <code>formatted
									onBrowse={browseHandler}
									onChange={e => setNewProjectResult({ ...newProjectResult, parentFolder: e.target.value })}
								/>
								{/* <div style={{ marginBottom: '16px' }}>
									Your project will be created at:&nbsp;
									<span style={{ fontFamily: 'monospace', color: '#D7BA7D' }}>
										{newProjectResult.parentFolder + '/' + newProjectResult.projectName}
									</span>
								</div> */}
							</PositronWizardSubStep>
							<PositronWizardSubStep>
								<Checkbox label='Initialize project as git repository' onChanged={checked => setNewProjectResult({ ...newProjectResult, initGitRepo: checked })} />
							</PositronWizardSubStep>
						</PositronWizardStep>
					)}
					{currentStep === 2 && (
						<PositronWizardStep
							title='Set up project environment'
							currentStep={currentStep}
							totalSteps={totalSteps}
							okButtonTitle={okButtonTitle}
							accept={acceptHandler}
							cancel={cancelHandler}
							back={backHandler}
							next={nextHandler}
						>
							<PositronWizardSubStep
								title='Python Interpreter'
							// description='Select a Python interpreter for your project. You can modify this later if you change your mind.'
							>
								<LabeledTextInput
									label='Select a Python interpreter for your project. You can modify this later if you change your mind'
									autoFocus
									value={''}
									onChange={e => console.log('python interpreter', e)}
								/>
							</PositronWizardSubStep>
							<PositronWizardSubStep
								// title='Python Environment'
								feedback={`The Venv environment will be created at: ${newProjectResult.parentFolder}/${newProjectResult.projectName}/.venv`}
							>
								<LabeledTextInput
									label='Python Environment'
									autoFocus
									value={'Create new environment'}
									onChange={e => console.log('create or reuse existing env', e)}
								/>
								<LabeledTextInput
									label='Select an environment type for your project'
									autoFocus
									value={'Venv'}
									onChange={e => console.log('python interpreter', e)}
								/>
							</PositronWizardSubStep>
							{/* Display the following note if we don't detect ipykernel for the selected interpreter */}
							<p>Note: Positron will install <code>ipykernel</code> in this environment for Python language support.</p>
						</PositronWizardStep>
					)}
				</PositronModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalReactRenderer.render(<NewProjectModalDialog />);
	});
};
