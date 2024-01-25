/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRow';

// React.
import * as React from 'react';

// Other dependencies.
import { useDataGridContext } from 'vs/base/browser/ui/dataGrid/dataGridContext';
import { DataGridRowCell } from 'vs/base/browser/ui/dataGrid/components/dataGridRowCell';

/**
 * DataGridRowProps interface.
 */
interface DataGridRowProps {
	width: number;
	rowIndex: number;
	top: number;
}

/**
 * DataRowGrid component.
 * @param props A DataGridRowProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRow = (props: DataGridRowProps) => {
	// Context hooks.
	const context = useDataGridContext();

	// Render the visible row cells.
	const rowCells: JSX.Element[] = [];
	for (let columnIndex = context.instance.firstColumnIndex, left = 0;
		columnIndex < context.instance.columns && left < props.width;
		columnIndex++
	) {
		// Access the column.
		const column = context.instance.column(columnIndex);

		// Push the column header component.
		rowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${columnIndex}`}
				column={column}
				columnIndex={columnIndex}
				rowIndex={props.rowIndex}
				left={left}
			/>
		);

		// Adjust the left offset for the next column.
		left += column.width;
	}

	// Render.
	return (
		<div
			className='data-grid-row'
			style={{
				top: props.top,
				height: context.instance.rowHeight
			}}
		>
			{rowCells}
		</div>
	);
};
