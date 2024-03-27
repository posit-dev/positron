/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { PropsWithChildren } from 'react';  // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { URI } from 'vs/base/common/uri';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStep';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardState';
import { PositronWizardStep } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/wizardSubStep';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { LabeledFolderInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledFolderInput';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';

/**
 * The ProjectNameLocationStep component is the second step in the new project wizard.
 * This component is shared by all project types. The next step in the wizard is determined by the
 * selected project type.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const ProjectNameLocationStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// Retrieve the wizard state and project configuration.
	const newProjectWizardState = useNewProjectWizardContext();
	const projectConfig = newProjectWizardState.projectConfig;
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const fileDialogs = newProjectWizardState.fileDialogService;

	// The browse handler.
	const browseHandler = async () => {
		// Show the open dialog.
		const uri = await fileDialogs.showOpenDialog({
			defaultUri: URI.file(projectConfig.parentFolder),
			canSelectFiles: false,
			canSelectFolders: true
		});

		// If the user made a selection, set the parent directory.
		if (uri?.length) {
			setProjectConfig({ ...projectConfig, parentFolder: uri[0].fsPath });
		}
	};

	// Navigate to the next step in the wizard, based on the selected project type.
	const nextStep = () => {
		// TODO: add handling for R and Jupyter projects
		switch (projectConfig.projectType) {
			case NewProjectType.RProject:
			case NewProjectType.JupyterNotebook:
			case NewProjectType.PythonProject:
				props.next(NewProjectWizardStep.PythonEnvironment);
		}
	};

	// General TODOs:
	//   - Create text input and folder input components which allow for the
	//     title + description + input box labelling in the mockups
	//   - Support mixed paragraph and code text, possibly using something like nls.
	return (
		<PositronWizardStep
			title={localize('projectNameLocationStep.title', 'Set project name and location')}
			cancelButtonConfig={{ onClick: props.cancel }}
			nextButtonConfig={{ onClick: nextStep }}
			backButtonConfig={{ onClick: props.back }}
		>
			<PositronWizardSubStep
				title={localize('projectNameLocationSubStep.projectName.label', 'Project Name')}
			// description={'Enter a name for your new ' + newProjectResult.projectType}
			>
				<LabeledTextInput
					label={localize('projectNameLocationSubStep.projectName.description', 'Enter a name for your new {0}', projectConfig.projectType)}
					autoFocus
					value={projectConfig.projectName}
					onChange={e => setProjectConfig({ ...projectConfig, projectName: e.target.value })}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title={localize('projectNameLocationSubStep.parentDirectory.label', 'Parent Directory')}
				// description='Select a directory to create your project in.'
				feedback={localize('projectNameLocationSubStep.parentDirectory.feedback', 'Your project will be created at: {0}/{1}', projectConfig.parentFolder, projectConfig.projectName)}
			>
				<LabeledFolderInput
					label={localize('projectNameLocationSubStep.parentDirectory.description', 'Select a directory to create your project in')}
					value={projectConfig.parentFolder} // this should be <code>formatted
					onBrowse={browseHandler}
					onChange={e => setProjectConfig({ ...projectConfig, parentFolder: e.target.value })}
				/>
				{/* <div style={{ marginBottom: '16px' }}>
					Your project will be created at:&nbsp;
					<span style={{ fontFamily: 'monospace', color: '#D7BA7D' }}>
						{newProjectResult.parentFolder + '/' + newProjectResult.projectName}
					</span>
				</div> */}
			</PositronWizardSubStep>
			<PositronWizardSubStep>
				{/* TODO: display a warning/message if the user doesn't have git set up */}
				<Checkbox
					label={localize('projectNameLocationSubStep.initGitRepo.label', 'Initialize project as Git repository')}
					onChanged={checked => setProjectConfig({ ...projectConfig, initGitRepo: checked })}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
