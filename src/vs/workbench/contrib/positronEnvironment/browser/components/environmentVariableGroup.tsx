/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroup';
import * as React from 'react';
import { KeyboardEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { IEnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/interfaces/environmentVariableGroup';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentVariableGroupProps interface.
 */
interface EnvironmentVariableGroupProps {
	environmentVariableGroup: IEnvironmentVariableGroup;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableGroup component.
 * @param props An EnvironmentVariableGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableGroup = (
	{ environmentVariableGroup, positronEnvironmentInstance }:
		PropsWithChildren<EnvironmentVariableGroupProps>
) => {
	/**
	 * Handles onKeyDown events.
	 * @param e A KeyboardEvent<HTMLDivElement> that describe a user interaction with the keyboard.
	 */
	const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.code === 'ArrowRight') {
			expand();
		} else if (e.code === 'ArrowLeft') {
			collapse();
		} else if (e.code === 'Enter' || e.code === 'Space') {
			toggleExpandCollapse();
		}
	};

	/**
	 * Handles onClick events.
	 */
	const handleClick = () => {
		toggleExpandCollapse();
	};

	/**
	 * Expands the group.
	 */
	const expand = () => {
		if (environmentVariableGroup.expanded) {
			return;
		}

		positronEnvironmentInstance.expandEnvironmentVariableGroup(environmentVariableGroup.id);
	};

	/**
	 * Collapses the group.
	 */
	const collapse = () => {
		if (!environmentVariableGroup.expanded) {
			return;
		}

		positronEnvironmentInstance.collapseEnvironmentVariableGroup(environmentVariableGroup.id);
	};

	/**
	 * Toggles expand / collapse of the group.
	 */
	const toggleExpandCollapse = () => {
		if (environmentVariableGroup.expanded) {
			collapse();
		} else {
			expand();
		}
	};

	// Render.
	return (
		<div className='environment-variable-group'
			role='button'
			tabIndex={0}
			onKeyDown={handleKeyDown}
			onClick={handleClick}>
			{environmentVariableGroup.expanded ?
				<div className={`expand-collapse-icon codicon codicon-chevron-down`}></div> :
				<div className={`expand-collapse-icon codicon codicon-chevron-right`}></div>
			}
			<div className='title'>
				{environmentVariableGroup.title}
			</div>
		</div>
	);
};
