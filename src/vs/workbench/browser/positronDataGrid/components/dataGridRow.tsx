/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRow';

// React.
import * as React from 'react';
import { DataGridRowCell } from './dataGridRowCell.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

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
	for (let columnDescriptor = context.instance.firstColumn;
		columnDescriptor && columnDescriptor.left < context.instance.layoutRight;
		columnDescriptor = context.instance.getColumn(columnDescriptor.columnIndex + 1)
	) {
		dataGridRowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${columnDescriptor.columnIndex}`}
				columnIndex={columnDescriptor.columnIndex}
				rowIndex={props.rowIndex}
				left={columnDescriptor.left - context.instance.horizontalScrollOffset}
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
