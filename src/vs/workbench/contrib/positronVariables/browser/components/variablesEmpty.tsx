/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './variablesEmpty.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';

// VariablesEmptyProps interface.
interface VariablesEmptyProps {
	initializing: boolean;
}

/**
 * Localized strings.
 */
const title = localize('positron.noVariablesCreated', 'No variables have been created.');
const titleFilter = localize('positron.noVariables.filter', 'No variables match the current filter.');

/**
 * VariablesEmpty component.
 * @param props A VariablesEmptyProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesEmpty = (props: VariablesEmptyProps) => {

	const context = usePositronVariablesContext();
	const hasFilter = context.activePositronVariablesInstance?.hasFilterText();

	return <div className='variables-empty'>
		{props.initializing ?
			<div className='title'>...</div> :
			<div className='title'>{hasFilter ? titleFilter : title}</div>
		}
	</div>;
};
