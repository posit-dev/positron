/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './projectTypeStep.css';

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { useNewProjectWizardContext } from '../../newProjectWizardContext.js';
import { NewProjectWizardStep } from '../../interfaces/newProjectWizardEnums.js';
import { NewProjectWizardStepProps } from '../../interfaces/newProjectWizardStepProps.js';
import { OKCancelBackNextActionBar } from '../../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';
import { ProjectTypeGroup } from '../projectTypeGroup.js';
import { checkProjectName } from '../../utilities/projectNameUtils.js';
import { NewProjectType } from '../../../../services/positronNewProject/common/positronNewProject.js';

/**
 * Generates a default project name in kebab case based on the provided project type.
 *
 * @param projectType - The type of the project for which to generate a default name.
 * @returns The default project name as a string.
 */
const getDefaultProjectName = (projectType: NewProjectType) => {
	return localize(
		'positron.newProjectWizard.projectTypeStep.defaultProjectNamePrefix',
		"my"
	) + '-' + projectType.toLowerCase().replace(/\s/g, '-');
};

/**
 * The ProjectTypeStep component is the first step in the new project wizard, used to
 * determine the type of project to create.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const ProjectTypeStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// State.
	const context = useNewProjectWizardContext();

	// Hooks.
	const [selectedProjectType, setSelectedProjectType] = useState(context.projectType);

	// Set the projectType and initialize the default project name if applicable,
	// then navigate to the ProjectNameLocation step.
	const nextStep = async () => {
		if (!selectedProjectType) {
			// If no project type is selected, return. This shouldn't happen since the Next button should
			// be disabled if no project type is selected.
			return;
		}
		// If the project type has changed or the project name is empty, initialize the project name.
		if (
			context.projectType !== selectedProjectType ||
			context.projectName === ''
		) {
			const defaultProjectName = getDefaultProjectName(selectedProjectType);
			context.projectType = selectedProjectType;
			context.projectName = defaultProjectName;
			context.projectNameFeedback = await checkProjectName(
				defaultProjectName,
				context.parentFolder,
				context.services.fileService
			);
		}
		props.next(NewProjectWizardStep.ProjectNameLocation);
	};

	// Render.
	return (
		<div className='project-type-selection-step'>
			<div
				className='project-type-selection-step-title'
				id='project-type-selection-step-title'
			>
				{(() =>
					localize(
						'positronNewProjectWizard.projectTypeStepTitle',
						"Project Type"
					))()}
			</div>
			<div
				className='project-type-selection-step-description'
				id='project-type-selection-step-description'
			>
				{(() =>
					localize(
						'positronNewProjectWizard.projectTypeStepDescription',
						"Select the type of project to create."
					))()}
			</div>
			<ProjectTypeGroup
				describedBy='project-type-selection-step-description'
				labelledBy='project-type-selection-step-title'
				name='projectType'
				selectedProjectId={selectedProjectType}
				onSelectionChanged={(projectType) =>
					setSelectedProjectType(projectType)
				}
			/>
			<OKCancelBackNextActionBar
				cancelButtonConfig={{
					onClick: props.cancel,
				}}
				nextButtonConfig={{
					onClick: nextStep,
					disable: !selectedProjectType,
				}}
			/>
		</div>
	);
};
