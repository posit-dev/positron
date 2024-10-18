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

	// Create the data grid column headers.
	const dataGridRowCells: JSX.Element[] = [];
	for (let columnLayoutEntry = context.instance.firstColumnLayoutEntry;
		columnLayoutEntry && columnLayoutEntry.start < context.instance.layoutRight;
		columnLayoutEntry = context.instance.getColumnLayoutEntry(columnLayoutEntry.index + 1)
	) {
		dataGridRowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${columnLayoutEntry.index}`}
				columnIndex={columnLayoutEntry.index}
				rowIndex={props.rowIndex}
				left={columnLayoutEntry.start - context.instance.horizontalScrollOffset}
			/>
		);
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
