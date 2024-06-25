/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectTypeGroup';

// React.
import * as React from 'react';
import { PropsWithChildren, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { ProjectType } from 'vs/workbench/browser/positronNewProjectWizard/components/projectType';
import { NewProjectType } from 'vs/workbench/services/positronNewProject/common/positronNewProject';

/**
 * ProjectTypeProps interface.
 */
interface ProjectTypeProps {
	name: string;
	selectedProjectId?: string;
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
	const projectTypes = Object.values(NewProjectType);

	// Hooks.
	const [currentSelection, setCurrentSelection] = useState(props.selectedProjectId);
	const [activeIndexId, setActiveIndexId] = useState(props.selectedProjectId ?? projectTypes[0] ?? '');

	// On project type selected, update the current selection and notify the parent.
	const onSelectionChanged = (projectType: NewProjectType) => {
		setCurrentSelection(projectType);
		setActiveIndexId(projectType);
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
			{projectTypes.map((projectType, index) => {
				return (
					<ProjectType
						key={index}
						identifier={projectType}
						groupName={props.name}
						selected={projectType === currentSelection}
						activeTabIndex={projectType === activeIndexId}
						onSelected={() => onSelectionChanged(projectType)}
					/>
				);
			})}
		</div>
	);
};
