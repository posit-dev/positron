/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariable';
import * as React from 'react';
import { EnvironmentVariableItem } from 'vs/workbench/services/positronEnvironment/common/classes/environmentVariableItem';
// import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentVariableProps interface.
 */
export interface EnvironmentVariableProps {
	environmentVariableItem: EnvironmentVariableItem;
}

/**
 * EnvironmentVariable component.
 * @param props A EnvironmentVariableProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentVariable = (props: EnvironmentVariableProps) => {
	// Hooks.
	//const positronEnvironmentContext = usePositronEnvironmentContext();

	// Get the name
	const data = props.environmentVariableItem.environmentVariable.data;
	let name = data.name;
	if (data.has_children) {
		name = '(+) ' + name;
	}

	// Handle click.
	const handleClick = () => {
		if (data.has_children) {
			// Toggle the children. Just gets the children for now; TODO: render them.
			props.environmentVariableItem.environmentVariable.getChildren().then(children => {
				console.info(`children: ${JSON.stringify(children.data)}`);
			});
		} else {
			// For items without children, fetch the formatted clipboard value. Totally a
			// placeholder; this just exists to exercise the API.
			props.environmentVariableItem.environmentVariable.formatForClipboard('text/plain').then(val => {
				console.info(`formatted value: ${val}`);
			});
		}
	};

	// Render.
	return (
		<div className='environment-variable' onClick={handleClick}>
			<div className='name'>{name}</div>
			<div className='value'>{data.value}</div>
		</div>
	);
};
