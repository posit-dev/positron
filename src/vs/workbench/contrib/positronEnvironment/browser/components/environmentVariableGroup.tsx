/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroup';
import * as React from 'react';
import { CSSProperties, MouseEvent, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentVariableGroupProps interface.
 */
interface EnvironmentVariableGroupProps {
	environmentVariableGroup: IEnvironmentVariableGroup;
	selected: boolean;
	focused: boolean;
	style: CSSProperties;
	onSelected: () => void;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableGroup component.
 * @param props An EnvironmentVariableGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableGroup = (props: EnvironmentVariableGroupProps) => {
	// Reference hooks.
	const ref = useRef<HTMLDivElement>(undefined!);

	/**
	 * MouseDown handler.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const mouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.onSelected();
	};


	// Create the class names.
	const classNames = positronClassNames(
		'environment-variable-group',
		{
			'selected': props.selected
		},
		{
			'focused': props.focused
		}
	);

	// Render.
	return (
		<div ref={ref} className={classNames} onMouseDown={mouseDownHandler} style={props.style}>
			{props.environmentVariableGroup.expanded ?
				<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
				<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
			}
			<div className='title'>
				{props.environmentVariableGroup.title}
			</div>
		</div>
	);
};
