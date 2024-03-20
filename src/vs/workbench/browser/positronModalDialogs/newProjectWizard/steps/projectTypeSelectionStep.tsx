/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./projectTypeSelectionStep';
const React = require('react');
import { PropsWithChildren } from 'react';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { OKCancelBackNextActionBar } from 'vs/base/browser/ui/positronModalDialog/components/okCancelBackNextActionBar';
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { NewProjectWizardStep } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStep';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/steps/newProjectWizardStepProps';

export const ProjectTypeSelectionStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	const newProjectWizardState = useNewProjectWizardContext();

	const next = () => {
		newProjectWizardState.setProjectConfig({ ...newProjectWizardState.projectConfig, projectType: 'R Project' });
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
