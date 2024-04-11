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
	activeTabIndex: boolean;
	onSelected: () => void;
}

/**
 * ProjectType component.
 * @param props The component properties.
 * @returns The rendered component.
 */
export const ProjectType = (props: ProjectTypeProps) => {
	const inputRef = useRef<HTMLInputElement>(null);

	const onSelected = () => {
		inputRef.current?.focus();
		props.onSelected();
	};

	// Render.
	return (
		<div className={'project-type' + (props.selected ? ' project-type-selected' : '')} onClick={onSelected}>
			<div className='project-type-icon'>
				{
					props.identifier === NewProjectType.PythonProject ? <PythonLogo /> :
						props.identifier === NewProjectType.JupyterNotebook ? <JupyterLogo /> :
							props.identifier === NewProjectType.RProject ? <RLogo /> :
								null
				}
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
			/>
			<label htmlFor={props.identifier}>{props.title}</label>
		</div>
	);
};
