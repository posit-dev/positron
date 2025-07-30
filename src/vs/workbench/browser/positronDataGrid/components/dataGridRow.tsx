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
import { ColumnDescriptors } from '../classes/dataGridInstance.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * DataGridRowProps interface.
 */
interface DataGridRowProps {
	columnDescriptors: ColumnDescriptors;
	height: number;
	pinned: boolean;
	rowIndex: number;
	top: number;
	width: number;
}

/**
 * DataRowGrid component.
 * @param props A DataGridRowProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRow = (props: DataGridRowProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Render the pinned data grid row cells.
	const dataGridRowCells: JSX.Element[] = [];
	for (const pinnedColumnDescriptor of props.columnDescriptors.pinnedColumnDescriptors) {
		dataGridRowCells.push(
			<DataGridRowCell
				key={`pinned-row-cell-${props.rowIndex}-${pinnedColumnDescriptor.columnIndex}`}
				columnIndex={pinnedColumnDescriptor.columnIndex}
				height={props.height}
				left={pinnedColumnDescriptor.left}
				pinned={true}
				rowIndex={props.rowIndex}
				width={pinnedColumnDescriptor.width}
			/>
		);
	}

	// Create the unpinned data grid column header elements.
	for (const unpinnedColumnDescriptor of props.columnDescriptors.unpinnedColumnDescriptors) {
		dataGridRowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${unpinnedColumnDescriptor.columnIndex}`}
				columnIndex={unpinnedColumnDescriptor.columnIndex}
				height={props.height}
				left={unpinnedColumnDescriptor.left - context.instance.horizontalScrollOffset}
				pinned={false}
				rowIndex={props.rowIndex}
				width={unpinnedColumnDescriptor.width}
			/>
		);
	}

	// Render.
	return (
		<div
			className={positronClassNames(
				'data-grid-row',
				{ pinned: props.pinned },
			)}
			style={{
				top: props.top,
				height: props.height,
			}}
		>
			{dataGridRowCells}
		</div>
	);
};
