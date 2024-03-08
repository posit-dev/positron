/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
import { VerticalStack } from 'vs/base/browser/ui/positronModalDialog/components/verticalStack';
import { VerticalSpacer } from 'vs/base/browser/ui/positronModalDialog/components/verticalSpacer';
import { LabeledTextInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/base/browser/ui/positronModalDialog/components/labeledFolderInput';
import { PositronModalDialogReactRenderer } from 'vs/base/browser/ui/positronModalDialog/positronModalDialogReactRenderer';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { PositronWizardModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronWizardModalDialog';

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
		// Create the modal dialog React renderer.
		const positronModalDialogReactRenderer =
			new PositronModalDialogReactRenderer(layoutService.mainContainer);

		// The new project modal dialog component.
		const NewProjectModalDialog = () => {
			// Hooks.
			const [newProjectResult, setNewProjectResult, newProjectResultRef] = useStateRef<NewProjectResult>({
				projectType: '',
				projectName: 'myPythonProject',
				parentFolder,
				initGitRepo: false,
				inheritDeps: false,
				installIpykernel: true,
				newWindow: false
			});
			const projectNameRef = useRef<HTMLInputElement>(undefined!);
			const [currentStep, setCurrentStep] = useState(0);
			const totalSteps = 4;

			// The accept handler.
			const acceptHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(newProjectResultRef.current);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalDialogReactRenderer.destroy();
				resolve(undefined);
			};

			const backHandler = () => {
				if (currentStep > 0) {
					setCurrentStep(currentStep - 1);
				}
				positronModalDialogReactRenderer.render(<NewProjectModalDialog />);
			};

			const nextHandler = () => {
				if (currentStep < totalSteps - 1) {
					setCurrentStep(currentStep + 1);
				}
				positronModalDialogReactRenderer.render(<NewProjectModalDialog />);
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
				<PositronWizardModalDialog
					width={700} height={500}
					title={localize('positronNewProjectModalDialogTitle', "Create New Project")}
					okButtonTitle={localize('positronNewProjectModalDialogCreateButtonTitle', "Create")}
					currentStep={currentStep}
					totalSteps={totalSteps}
					accept={acceptHandler} cancel={cancelHandler} back={backHandler} next={nextHandler}>
					{currentStep === 0 && (
						<>
							<div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '16px', marginBottom: '16px' }}>Project Type</div>
							<div style={{ fontSize: '13px', color: '#CCCCCC', marginTop: '16px', marginBottom: '16px' }}>Select the type of project to create.</div>
							<div className='project-type-grid'>
								<PositronButton>
									<div className='line' style={{ marginLeft: '20px', width: '200px' }}>Pure Python Project</div>
								</PositronButton>
								<PositronButton>
									<div className='line' style={{ marginLeft: '20px', width: '200px' }}>Jupyter Notebook</div>
								</PositronButton>
								<PositronButton>
									<div className='line' style={{ marginLeft: '20px', width: '200px' }}>R Project</div>
								</PositronButton>
							</div>
						</>
					)}
					{currentStep === 1 && (
						<>
							<div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '16px', marginBottom: '32px' }}>Set project name and location</div>
							<VerticalStack>
								<LabeledTextInput
									ref={projectNameRef}
									label='Project name'
									autoFocus
									value={newProjectResult.projectName}
									onChange={e => setNewProjectResult({ ...newProjectResult, projectName: e.target.value })} />
								<LabeledFolderInput
									label='Create project as subfolder of'
									value={newProjectResult.parentFolder}
									onBrowse={browseHandler}
									onChange={e => setNewProjectResult({ ...newProjectResult, parentFolder: e.target.value })} />
								<div style={{ marginBottom: '16px' }}>
									Your project will be created at:&nbsp;
									<span style={{ fontFamily: 'monospace', color: '#D7BA7D' }}>
										{newProjectResult.parentFolder + '/' + newProjectResult.projectName}
									</span>
								</div>
							</VerticalStack>
							<VerticalSpacer>
								<Checkbox label='Initialize project as git repository' onChanged={checked => setNewProjectResult({ ...newProjectResult, initGitRepo: checked })} />
								{/* <Checkbox label='Open in a new window' onChanged={checked => setNewProjectResult({ ...newProjectResult, newWindow: checked })} /> */}
							</VerticalSpacer>
						</>
					)}
					{currentStep === 2 && (
						<>
							<div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '16px', marginBottom: '32px' }}>Set up project environment</div>
							<VerticalStack>
								<LabeledTextInput
									// ref={projectNameRef}
									label='Python Interpreter'
									autoFocus
									value={''}
									onChange={e => console.log('python interpreter', e)} />
							</VerticalStack>
						</>
					)}
					{currentStep === 3 && (
						<>
							<div style={{ fontSize: '26px', fontWeight: 'bold', marginTop: '16px', marginBottom: '32px' }}>Install initial dependencies</div>
							<VerticalStack>
								<div>
									Select initial dependencies to install into the project environment at:&nbsp;
									<span style={{ fontFamily: 'monospace', color: '#D7BA7D' }}>
										{newProjectResult.parentFolder + '/' + newProjectResult.projectName + '/.venv'}
									</span>
								</div>
								<Checkbox label='Install dependencies from selected interpreter' onChanged={checked => setNewProjectResult({ ...newProjectResult, inheritDeps: checked })} />
								<Checkbox label='Install ipykernel for Positron Python support' defaultValue={true} onChanged={checked => setNewProjectResult({ ...newProjectResult, installIpykernel: checked })} />
							</VerticalStack>
						</>
					)}
				</PositronWizardModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalDialogReactRenderer.render(<NewProjectModalDialog />);
	});
};
