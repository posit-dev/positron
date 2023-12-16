/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnController';
import * as React from 'react';

/**
 * ColumnControllerProps interface.
 */
interface ColumnControllerProps {
}

/**
 * ColumnController component.
 * @param props A ColumnControllerProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnController = (props: ColumnControllerProps) => {
	return (
		<div className='column-controller'>
			<div className='title'>Name</div>
		</div>
	);
};
