/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectTypeGroup';

// React.
import * as React from 'react';
import { PropsWithChildren, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ProjectType } from 'vs/workbench/browser/positronNewProjectWizard/components/projectType';
import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';

/**
 * ProjectTypeProps interface.
 */
interface ProjectTypeProps {
	name: string;
	initialSelectionId?: string;
	labelledBy?: string;
	describedBy?: string;
	onSelectionChanged: (projectType: NewProjectType) => void;
}

/**
 * ProjectTypeGroup component.
 * @param props The component properties.
 * @returns The rendered component.
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/radio/ for accessibility guidelines.
 */
export const ProjectTypeGroup = (props: PropsWithChildren<ProjectTypeProps>) => {
	// Hooks.
	const [currentSelection, setCurrentSelection] = useState(props.initialSelectionId);

	// On project type selected, update the current selection and notify the parent.
	const onSelectionChanged = (projectType: NewProjectType) => {
		setCurrentSelection(projectType);
		props.onSelectionChanged(projectType);
	};

	// Render.
	return (
		<div
			className='project-type-group'
			role='radiogroup'
			aria-labelledby={props.labelledBy}
			aria-describedby={props.describedBy}
		>
			{Object.values(NewProjectType).map((projectType, index) => {
				return (
					<ProjectType
						key={index}
						identifier={projectType}
						title={projectType}
						groupName={props.name}
						selected={projectType === currentSelection}
						onSelected={() => onSelectionChanged(projectType)}
					/>
				);
			})}
		</div>
	);
};
