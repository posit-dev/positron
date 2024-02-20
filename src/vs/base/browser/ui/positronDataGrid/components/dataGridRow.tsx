/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRow';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridRowCell } from 'vs/base/browser/ui/positronDataGrid/components/dataGridRowCell';
import { usePositronDataGridContext } from 'vs/base/browser/ui/positronDataGrid/positronDataGridContext';

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
	const context = usePositronDataGridContext();

	// Render the visible row cells.
	const rowCells: JSX.Element[] = [];
	for (let columnIndex = context.instance.firstColumnIndex, left = 0;
		columnIndex < context.instance.columns && left < props.width;
		columnIndex++
	) {
		rowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${columnIndex}`}
				columnIndex={columnIndex}
				rowIndex={props.rowIndex}
				left={left}
			/>
		);

		// Adjust the left offset for the next column.
		left += context.instance.getColumnWidth(columnIndex);
	}

	// Render.
	return (
		<div
			className='data-grid-row'
			style={{
				top: props.top,
				height: context.instance.getRowHeight(props.rowIndex)
			}}
		>
			{rowCells}
		</div>
	);
};
