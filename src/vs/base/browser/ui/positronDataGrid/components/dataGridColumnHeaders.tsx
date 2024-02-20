/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeaders';

// React.
import * as React from 'react';

// Other dependencies.
import { usePositronDataGridContext } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';
import { DataGridColumnHeader } from 'vs/base/browser/ui/positronDataGrid/components/dataGridColumnHeader';

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

	// Render the visible column headers.
	const columnHeaders: JSX.Element[] = [];
	for (let columnIndex = context.instance.firstColumnIndex, left = 0;
		columnIndex < context.instance.columns && left < props.width;
		columnIndex++
	) {
		// Access the column.
		const column = context.instance.column(columnIndex);

		// Push the column header component.
		columnHeaders.push(
			<DataGridColumnHeader
				key={columnIndex}
				column={column}
				columnIndex={columnIndex}
				left={left}
			/>
		);

		// Adjust the left offset for the next column.
		left += context.instance.getColumnWidth(columnIndex);
	}

	// Render.
	return (
		<div className='data-grid-column-headers' style={{ height: props.height }}>
			{columnHeaders}
		</div>
	);
};
