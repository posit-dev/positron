/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./rowsPanel';
import * as React from 'react';

/**
 * RowsPanelProps interface.
 */
interface ColumnsPanelProps {
}

/**
 * RowsPanel component.
 * @param props A RowsPanelProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowsPanel = (props: ColumnsPanelProps) => {
	return (
		<div className='rows-panel'>
			<div className='title'>Rows</div>
		</div>
	);
};
