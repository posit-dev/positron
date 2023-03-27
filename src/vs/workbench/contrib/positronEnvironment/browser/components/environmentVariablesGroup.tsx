/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariablesGroup';
import * as React from 'react';
import { KeyboardEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * EnvironmentVariablesGroupProps interface.
 */
interface EnvironmentVariablesGroupProps {
	title: string;
	expanded: boolean;
	onExpand: () => void;
	onCollapse: () => void;
	onToggleExpandCollapse: () => void;
}

/**
 * EnvironmentVariablesGroup component.
 * @param props A EnvironmentInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariablesGroup = (
	props: PropsWithChildren<EnvironmentVariablesGroupProps>
) => {
	/**
	 * Handles onKeyDown events.
	 * @param e A KeyboardEvent<HTMLDivElement> that describe a user interaction with the keyboard.
	 */
	const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.code === 'ArrowRight') {
			props.onExpand();
		} else if (e.code === 'ArrowLeft') {
			props.onCollapse();
		} else if (e.code === 'Enter' || e.code === 'Space') {
			props.onToggleExpandCollapse();
		}
	};

	// Render.
	return (
		<>
			<div className='environment-variables-group'
				role='button'
				tabIndex={0}
				onKeyDown={handleKeyDown}
				onClick={props.onToggleExpandCollapse}>
				{props.expanded ?
					<div className={`expand-collapse-icon codicon codicon-chevron-down`}></div> :
					<div className={`expand-collapse-icon codicon codicon-chevron-right`}></div>
				}
				<div className='title'>
					{props.title}
				</div>
			</div>
			{props.expanded && props.children}
		</>
	);
};
