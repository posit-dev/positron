/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectType';

// React.
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';
import { PythonLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoPython';
import { JupyterLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoJupyter';
import { RLogo } from 'vs/workbench/browser/positronNewProjectWizard/components/logos/logoR';
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';

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
	const projectTypeSelected = () => projectType !== undefined;
	const inputRef = useRef<HTMLInputElement>(null);

	// On project type selected, set the focus to the input element and notify the parent.
	const onSelected = () => {
		inputRef.current?.focus();
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
				autoFocus={projectTypeSelected() && props.activeTabIndex}
			/>
			<label htmlFor={props.identifier}>{props.identifier}</label>
		</div>
	);
};
