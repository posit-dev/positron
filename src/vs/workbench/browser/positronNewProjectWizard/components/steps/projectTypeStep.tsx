/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectTypeStep';

// React.
import * as React from 'react';
import { PropsWithChildren, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectType, NewProjectWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { OKCancelBackNextActionBar } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/okCancelBackNextActionBar';
import { ProjectTypeGroup } from 'vs/workbench/browser/positronNewProjectWizard/components/projectTypeGroup';
import { getProjectTypeItems } from 'vs/workbench/browser/positronNewProjectWizard/utilities/projectTypeStepUtils';

/**
 * The ProjectTypeStep component is the first step in the new project wizard, used to
 * determine the type of project to create.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const ProjectTypeStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// Retrieve the wizard state and project configuration.
	const newProjectWizardState = useNewProjectWizardContext();
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const projectConfig = newProjectWizardState.projectConfig;
	const languageRuntimeService = newProjectWizardState.languageRuntimeService;

	// Hooks.
	const [selectedProjectType, setSelectedProjectType] = useState(projectConfig.projectType);

	// Set the projectType and initialize the default project name if applicable,
	// then navigate to the ProjectNameLocation step.
	const nextStep = () => {
		// TODO: once we have input validation, the user should not be able to proceed until a
		// project type is selected, so we won't have to check that the selectedProjectType is not null.
		const projectType = selectedProjectType ?? NewProjectType.PythonProject;
		// If the project type has changed or the project name is empty, initialize the project name.
		if (projectConfig.projectType !== projectType || projectConfig.projectName === '') {
			// The default project name is 'my' + projectType without spaces, eg. 'myPythonProject'.
			const defaultProjectName =
				localize(
					"positron.newProjectWizard.projectTypeStep.defaultProjectNamePrefix",
					"my"
				) + projectType.replace(/\s/g, '');
			setProjectConfig({
				...projectConfig,
				projectType,
				projectName: defaultProjectName
			});
		}
		props.next(NewProjectWizardStep.ProjectNameLocation);
	};

	// Render.
	return (
		<div className='project-type-selection-step'>
			<div className='project-type-selection-step-title' id='project-type-selection-step-title' >
				{(() => localize('positronNewProjectWizard.projectTypeStepTitle', 'Project Type'))()}
			</div>
			<div className='project-type-selection-step-description' id='project-type-selection-step-description' >
				{(() => localize('positronNewProjectWizard.projectTypeStepDescription', 'Select the type of project to create.'))()}
			</div>
			<ProjectTypeGroup
				name='projectType'
				labelledBy='project-type-selection-step-title'
				describedBy='project-type-selection-step-description'
				entries={getProjectTypeItems(languageRuntimeService)}
				selectedProjectId={selectedProjectType}
				onSelectionChanged={projectType => setSelectedProjectType(projectType)}
			/>
			<OKCancelBackNextActionBar
				cancelButtonConfig={{
					onClick: props.cancel
				}}
				nextButtonConfig={{
					onClick: nextStep
				}}
			/>
		</div>
	);
};
