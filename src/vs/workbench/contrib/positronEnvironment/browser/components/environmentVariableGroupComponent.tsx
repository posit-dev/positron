/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariableGroupComponent';
import * as React from 'react';
import { KeyboardEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { EnvironmentVariableGroup } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableGroup';
import { IPositronEnvironmentInstance } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';

/**
 * EnvironmentVariableGroupComponentProps interface.
 */
interface EnvironmentVariableGroupComponentProps {
	environmentVariableGroup: EnvironmentVariableGroup;
	positronEnvironmentInstance: IPositronEnvironmentInstance;
}

/**
 * EnvironmentVariableGroupComponent component.
 * @param props An EnvironmentVariableGroupComponentProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariableGroupComponent = (
	{ environmentVariableGroup, positronEnvironmentInstance }:
		PropsWithChildren<EnvironmentVariableGroupComponentProps>
) => {
	const expand = () => {
		if (environmentVariableGroup.expanded) {
			return;
		}

		positronEnvironmentInstance.expandEnvironmentVariableGroup(environmentVariableGroup.id);
	};

	const collapse = () => {
		if (!environmentVariableGroup.expanded) {
			return;
		}

		positronEnvironmentInstance.collapseEnvironmentVariableGroup(environmentVariableGroup.id);
	};

	const toggleExpandCollapse = () => {
		if (environmentVariableGroup.expanded) {
			collapse();
		} else {
			expand();
		}
	};

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

	const handleClick = () => {
		toggleExpandCollapse();
	};

	// Render.
	return (
		<>
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
		</>
	);
};
