/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./tableDataRowHeader';

// React.
import * as React from 'react';

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
