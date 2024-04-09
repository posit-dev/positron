/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectType';

// React.
import React = require('react');
import { NewProjectType } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardEnums';

/**
 * ProjectTypeItemOptions interface.
 */
interface ProjectTypeItemOptions {
	identifier: NewProjectType;
	title: string;
	icon: string;
}

/**
 * ProjectTypeItem class.
 */
export class ProjectTypeItem {
	/**
	 * Constructor.
	 * @param options A ProjectTypeItemOptions that contains the project type item options.
	 */
	constructor(readonly options: ProjectTypeItemOptions) { }
}

/**
 * ProjectTypeProps interface.
 */
interface ProjectTypeProps extends ProjectTypeItemOptions {
	selected: boolean;
	groupName: string;
	onSelected: () => void;
}

/**
 * ProjectType component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ProjectType = (props: ProjectTypeProps) => {
	// Render.
	return (
		<div className='project-type'>
			<img className='project-type-icon' src={`data:image/svg+xml;base64,${props.icon}`} />
			<input
				className='project-type-input'
				type='radio'
				tabIndex={props.selected ? 0 : -1}
				id={props.identifier}
				name={props.groupName}
				value={props.identifier}
				checked={props.selected}
				onClick={props.onSelected}
			/>
			<label htmlFor={props.identifier}>{props.title}</label>
		</div>
	);
};
