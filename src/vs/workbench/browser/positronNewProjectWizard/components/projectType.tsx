/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectType';

// React.
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { PythonLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoPython';
import { JupyterLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoJupyter';
import { RLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoR';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectType } from 'vs/workbench/services/positronNewProject/common/positronNewProject';

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
				className='project-type-input'
				type='radio'
				tabIndex={props.activeTabIndex ? 0 : -1}
				id={props.identifier}
				name={props.groupName}
				value={props.identifier}
				checked={props.selected}
				// Set the autofocus to the selected project type when the user navigates back to
				// the project type step.
				autoFocus={projectType && props.activeTabIndex}
			/>
			<label htmlFor={props.identifier}>{props.identifier}</label>
		</div>
	);
};
