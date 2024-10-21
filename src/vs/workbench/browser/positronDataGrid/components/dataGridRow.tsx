/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRow';

// React.
import * as React from 'react';
import { DataGridRowCell } from 'vs/workbench/browser/positronDataGrid/components/dataGridRowCell';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

// Other dependencies.

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

	let { left, columnIndex } = context.instance.firstColumn;

	// Render the visible row cells.
	const rowCells: JSX.Element[] = [];
	while (left - context.instance.horizontalScrollOffset < props.width && columnIndex < context.instance.columns) {
		rowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${columnIndex}`}
				columnIndex={columnIndex}
				rowIndex={props.rowIndex}
				left={left - context.instance.horizontalScrollOffset}
			/>
		);

		left += context.instance.getColumnWidth(columnIndex);
		columnIndex++;
	}

	// for (let columnIndex = context.instance.firstColumnIndexXX, left = 0;
	// 	columnIndex < context.instance.columns && left < props.width;
	// 	columnIndex++
	// ) {
	// 	rowCells.push(
	// 		<DataGridRowCell
	// 			key={`row-cell-${props.rowIndex}-${columnIndex}`}
	// 			columnIndex={columnIndex}
	// 			rowIndex={props.rowIndex}
	// 			left={left}
	// 		/>
	// 	);

	// 	// Adjust the left offset for the next column.
	// 	left += context.instance.getColumnWidth(columnIndex);
	// }

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
