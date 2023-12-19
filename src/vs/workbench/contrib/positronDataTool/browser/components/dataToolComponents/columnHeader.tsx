/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnHeader';
import * as React from 'react';

/**
 * ColumnHeaderProps interface.
 */
interface ColumnHeaderProps {
}

/**
 * ColumnHeader component.
 * @param props A ColumnHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnHeader = (props: ColumnHeaderProps) => {
	return (
		<div className='column-header'>
			<div className='title'>Name</div>
		</div>
	);
};
