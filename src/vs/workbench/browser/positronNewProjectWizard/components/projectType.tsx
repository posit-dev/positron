/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./projectType';

// React.
import React = require('react');

/**
 * ProjectTypeProps interface.
 */
interface ProjectTypeProps {
	identifier: string;
	title: string;
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
