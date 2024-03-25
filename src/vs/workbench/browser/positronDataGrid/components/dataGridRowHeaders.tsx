/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
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

	// Render the row headers.
	const rowHeaders: JSX.Element[] = [];
	for (let rowIndex = context.instance.firstRowIndex, top = 0;
		rowIndex < context.instance.rows && top < props.height;
		rowIndex++
	) {
		// Push the row header component.
		rowHeaders.push(
			<DataGridRowHeader key={rowIndex} rowIndex={rowIndex} top={top} />
		);

		// Adjust the top offset for the next row.
		top += context.instance.getRowHeight(rowIndex);
	}

	// Render.
	return (
		<div className='data-grid-row-headers' style={{ width: context.instance.rowHeadersWidth }}>
			{rowHeaders}
		</div>
	);
};
