/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeaders';

// React.
import * as React from 'react';

// Other dependencies.
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { DataGridColumnHeader } from 'vs/workbench/browser/positronDataGrid/components/dataGridColumnHeader';

// Other dependencies.

/**
 * DataGridColumnHeadersProps interface.
 */
interface DataGridColumnHeadersProps {
	width: number;
	height: number;
}

/**
 * DataGridColumnHeaders component.
 * @param props A DataGridColumnHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridColumnHeaders = (props: DataGridColumnHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	let { left, columnIndex } = context.instance.firstColumn;

	// Render the visible column headers.
	const columnHeaders: JSX.Element[] = [];
	while (left - context.instance.horizontalScrollOffset < props.width && columnIndex < context.instance.columns) {
		// Access the column.
		const column = context.instance.column(columnIndex);

		// Push the column header component.
		columnHeaders.push(
			<DataGridColumnHeader
				key={columnIndex}
				column={column}
				columnIndex={columnIndex}
				left={left - context.instance.horizontalScrollOffset}
			/>
		);

		// Adjust the left offset for the next column.
		left += context.instance.getColumnWidth(columnIndex);
		columnIndex++;
	}
	// 	for (let columnIndex = context.instance.firstColumnIndexXX, left = 0;
	// 	columnIndex < context.instance.columns && left < props.width;
	// 	columnIndex++
	// ) {
	// 	// Access the column.
	// 	const column = context.instance.column(columnIndex);

	// 	// Push the column header component.
	// 	columnHeaders.push(
	// 		<DataGridColumnHeader
	// 			key={columnIndex}
	// 			column={column}
	// 			columnIndex={columnIndex}
	// 			left={left}
	// 		/>
	// 	);

	// 	// Adjust the left offset for the next column.
	// 	left += context.instance.getColumnWidth(columnIndex);
	// }

	// Render.
	return (
		<div className='data-grid-column-headers' style={{ height: props.height }}>
			{columnHeaders}
		</div>
	);
};
