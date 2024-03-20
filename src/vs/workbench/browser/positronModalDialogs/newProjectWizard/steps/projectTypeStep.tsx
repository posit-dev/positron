/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./projectTypeStep';
const React = require('react');
import { PropsWithChildren } from 'react';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { OKCancelBackNextActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelBackNextActionBar';
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStep';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';
import { NewProjectType } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardState';

export const ProjectTypeStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();

	const next = () => {
		// TODO: set the projectType according to the selected button
		const projectType = NewProjectType.PythonProject;
		const defaultProjectName = 'my' + projectType.replace(/\s/g, '');
		newProjectWizardState.setProjectConfig({ ...newProjectWizardState.projectConfig, projectType, projectName: defaultProjectName });
		props.next(NewProjectWizardStep.ProjectNameLocation);
	};

	return (
		<div className='project-type-selection-step'>
			<div className='project-type-selection-step-title'>
				{localize('positronNewProjectWizard.projectTypeTitle', 'Project Type')}
			</div>
			<div className='project-type-selection-step-description'>
				Select the type of project to create.
			</div>
			<div className='project-type-grid'>
				{/* TODO: convert from buttons to radio buttons or checkboxes */}
				{/* Write tsx that create a Button with className project-type-button for each project type in NewProjectType */}

				<Button className='project-type-button'>
					{NewProjectType.PythonProject}
				</Button>
				<Button className='project-type-button'>
					{NewProjectType.RProject}
				</Button>
				<Button className='project-type-button'>
					{NewProjectType.JupyterNotebook}
				</Button>
			</div>
			<OKCancelBackNextActionBar
				cancelButtonConfig={{
					onClick: props.cancel
				}}
				nextButtonConfig={{
					onClick: next
				}}
			/>
		</div>
	);
};
