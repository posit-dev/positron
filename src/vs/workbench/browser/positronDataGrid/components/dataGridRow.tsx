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

	// Create the data grid row cells.
	const dataGridRowCells: JSX.Element[] = [];
	if (context.instance.columns) {
		// Get the first column.
		let { left, columnIndex } = context.instance.firstColumn;

		// Create the data grid row cells.
		const right = context.instance.horizontalScrollOffset + context.instance.layoutWidth;
		while (columnIndex < context.instance.columns && left < right) {
			// Create and add the data grid row cell.
			dataGridRowCells.push(
				<DataGridRowCell
					key={`row-cell-${props.rowIndex}-${columnIndex}`}
					columnIndex={columnIndex}
					rowIndex={props.rowIndex}
					left={left - context.instance.horizontalScrollOffset}
				/>
			);

			// Get the column width.
			const columnWidth = context.instance.getColumnWidth(columnIndex);
			if (!columnWidth) {
				break;
			}

			// Advance to the next data grid row cell.
			columnIndex++;
			left += columnWidth;
		}
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
			{dataGridRowCells}
		</div>
	);
};
