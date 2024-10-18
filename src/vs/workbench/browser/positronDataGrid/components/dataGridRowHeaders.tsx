/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRowHeaders';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridRowHeader } from 'vs/workbench/browser/positronDataGrid/components/dataGridRowHeader';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

/**
 * DataGridRowHeadersProps interface.
 */
interface DataGridRowHeadersProps {
	height: number;
}

/**
 * DataGridRowHeaders component.
 * @param props A DataGridRowHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRowHeaders = (props: DataGridRowHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Create the data grid rows headers.
	const dataGridRowHeaders: JSX.Element[] = [];
	for (let rowLayoutEntry = context.instance.firstRowLayoutEntry;
		rowLayoutEntry && rowLayoutEntry.start < context.instance.layoutBottom;
		rowLayoutEntry = context.instance.getRowLayoutEntry(rowLayoutEntry.index + 1)
	) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={rowLayoutEntry.index}
				rowIndex={rowLayoutEntry.index}
				top={rowLayoutEntry.start - context.instance.verticalScrollOffset}
			/>
		);
	}

	// Render.
	return (
		<div className='data-grid-row-headers' style={{ width: context.instance.rowHeadersWidth }}>
			{dataGridRowHeaders}
		</div>
	);
};
