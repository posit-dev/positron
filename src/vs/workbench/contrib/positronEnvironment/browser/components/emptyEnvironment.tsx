/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyEnvironment';
import * as React from 'react';

// EmptyEnvironmentProps interface.
interface EmptyEnvironmentProps {
	initializing: boolean;
}

/**
 * EmptyEnvironment component.
 * @param props A EmptyEnvironmentProps that contains the component properties.
 * @returns The rendered component.
 */
export const EmptyEnvironment = (props: EmptyEnvironmentProps) => {
	return <div className='empty-environment'>
		{props.initializing ?
			<div className='title'>...</div> :
			<div className='title'>Environment is empty</div>
		}
	</div>;
};
