/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './tableDataRowHeader.css';

// React.
import React from 'react';

/**
 * TableDataRowHeaderProps interface.
 */
interface TableDataRowHeaderProps {
	value: string;
}

/**
 * TableDataRowHeader component.
 * @param props A TableDataRowHeaderProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataRowHeader = (props: TableDataRowHeaderProps) => {
	// Render.
	return (
		<div className='text'>
			{props.value}
		</div>
	);
};
