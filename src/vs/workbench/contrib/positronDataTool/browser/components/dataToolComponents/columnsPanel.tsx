/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./columnsPanel';
import * as React from 'react';

/**
 * ColumnsPanelProps interface.
 */
interface ColumnsPanelProps {
}

/**
 * ColumnsPanel component.
 * @param props A ColumnsPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnsPanel = (props: ColumnsPanelProps) => {
	return (
		<div className='columns-panel'>
			<div className='title'>Columns</div>
		</div>
	);
};
