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

	// Render.
	return (
		<div className='xxx-xxx'>{props.environmentVariableItem.environmentVariable.name} - {props.environmentVariableItem.environmentVariable.value}</div>
	);
};
