/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroup';
import * as React from 'react';
import { useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentVariableGroupProps interface.
 */
interface EnvironmentVariableGroupProps {
	environmentVariableGroup: IEnvironmentVariableGroup;
	focused: boolean;
	selected: boolean;
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
	 * Handles onClick events.
	 */
	const handleClick = () => {
	};

	// Create the class names.
	const classNames = positronClassNames(
		'environment-variable-group',
		{ 'selected': props.selected }
	);

	if (props.selected && ref.current) {
		ref.current.scrollIntoView({ block: 'nearest' });
	}

	// Render.
	return (
		<div ref={ref} className={classNames} onClick={handleClick}>
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
