/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./emptyEnvironment';
import * as React from 'react';

/**
 * EmptyEnvironment component.
 * @returns The rendered component.
 */
export const EmptyEnvironment = () => {
	return <div className='empty-environment'>
		<div className='title'>Environment is empty</div>
	</div>;
};
