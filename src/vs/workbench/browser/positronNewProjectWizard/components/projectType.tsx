/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './projectType.css';

// React.
import React, { useRef } from 'react';

// Other dependencies.
import { PythonLogo } from './logos/logoPython.js';
import { JupyterLogo } from './logos/logoJupyter.js';
import { RLogo } from './logos/logoR.js';
import { useNewProjectWizardContext } from '../newProjectWizardContext.js';
import { NewProjectType } from '../../../services/positronNewProject/common/positronNewProject.js';

/**
 * ProjectTypeProps interface.
 */
interface ProjectTypeProps {
	identifier: NewProjectType;
	selected: boolean;
	groupName: string;
	activeTabIndex: boolean;
	onSelected: () => void;
}

/**
 * ProjectType component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ProjectType = (props: ProjectTypeProps) => {
	// State.
	const { projectType } = useNewProjectWizardContext();
	// Use undefined! instead of null to avoid optional chaining and so that an error is thrown if
	// the ref is accessed before it is assigned.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// On project type selected, set the focus to the input element and notify the parent.
	const onSelected = () => {
		inputRef.current.focus();
		props.onSelected();
	};

	// Render.
	return (
		<div
			className={
				'project-type' +
				(props.selected ? ' project-type-selected' : '')
			}
			onClick={onSelected}
		>
			<div className='project-type-icon'>
				{props.identifier === NewProjectType.PythonProject ? (
					<PythonLogo />
				) : props.identifier === NewProjectType.JupyterNotebook ? (
					<JupyterLogo />
				) : props.identifier === NewProjectType.RProject ? (
					<RLogo />
				) : null}
			</div>
			<input
				ref={inputRef}
				autoFocus={projectType && props.activeTabIndex}
				checked={props.selected}
				className='project-type-input'
				id={props.identifier}
				name={props.groupName}
				tabIndex={props.activeTabIndex ? 0 : -1}
				type='radio'
				// Set the autofocus to the selected project type when the user navigates back to
				// the project type step.
				value={props.identifier}
			/>
			<label htmlFor={props.identifier}>{props.identifier}</label>
		</div>
	);
};
