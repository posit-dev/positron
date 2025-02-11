/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './projectTypeGroup.css';

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { ProjectType } from './projectType.js';
import { NewProjectType } from '../../../services/positronNewProject/common/positronNewProject.js';

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
			aria-describedby={props.describedBy}
			aria-labelledby={props.labelledBy}
			className='project-type-group'
			role='radiogroup'
		>
			{projectTypes.map((projectType, index) => {
				return (
					<ProjectType
						key={index}
						activeTabIndex={projectType === activeIndexId}
						groupName={props.name}
						identifier={projectType}
						selected={projectType === currentSelection}
						onSelected={() => onSelectionChanged(projectType)}
					/>
				);
			})}
		</div>
	);
};
