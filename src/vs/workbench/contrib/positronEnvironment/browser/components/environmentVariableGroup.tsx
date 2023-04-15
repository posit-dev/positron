/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroup';
import * as React from 'react';
import { CSSProperties, MouseEvent } from 'react'; // eslint-disable-line no-duplicate-imports
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
	onToggleExpandCollapse: () => void;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableGroup component.
 * @param props An EnvironmentVariableGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableGroup = (props: EnvironmentVariableGroupProps) => {
	/**
	 * MouseDown handler for the row.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const rowMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.onSelected();
	};

	/**
	 * MouseDown handler for the chevron.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const chevronMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	/**
	 * MouseUp handler for the chevron.
	 * @param e A MouseEvent<HTMLElement> that describes a user interaction with the mouse.
	 */
	const chevronMouseUpHandler = (e: MouseEvent<HTMLElement>) => {
		e.preventDefault();
		e.stopPropagation();
		props.onToggleExpandCollapse();
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
		<div className={classNames} onMouseDown={rowMouseDownHandler} style={props.style}>
			<div className='expand-collapse-area'>
				{props.environmentVariableGroup.expanded ?
					<div className={`expand-collapse-icon codicon codicon-chevron-down`} onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler} /> :
					<div className={`expand-collapse-icon codicon codicon-chevron-right`} onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler} />
				}
			</div>
			<div className='title'>
				{props.environmentVariableGroup.title}
			</div>
		</div>
	);
};
