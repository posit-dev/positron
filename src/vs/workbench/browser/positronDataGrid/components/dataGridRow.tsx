/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridRow.css';

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { DataGridRowCell } from './dataGridRowCell.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

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
	// FALSE POSITIVE: The ESLint rule of hooks is incorrectly flagging this line as a violation of
	// the rules of hooks. See: https://github.com/facebook/react/issues/31687
	// eslint-disable-next-line react-hooks/rules-of-hooks
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
				left={columnDescriptor.left - context.instance.horizontalScrollOffset}
				rowIndex={props.rowIndex}
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
