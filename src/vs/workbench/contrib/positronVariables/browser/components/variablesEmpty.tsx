/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./variablesEmpty';
import * as React from 'react';
import { localize } from 'vs/nls';

// VariablesEmptyProps interface.
interface VariablesEmptyProps {
	initializing: boolean;
}

/**
 * Localized strings.
 */
const title = localize('positron.variablesIsEmpty', 'Variables is empty.');

/**
 * VariablesEmpty component.
 * @param props A VariablesEmptyProps that contains the component properties.
 * @returns The rendered component.
 */
export const VariablesEmpty = (props: VariablesEmptyProps) => {
	return <div className='variables-empty'>
		{props.initializing ?
			<div className='title'>...</div> :
			<div className='title'>{title}</div>
		}
	</div>;
};
