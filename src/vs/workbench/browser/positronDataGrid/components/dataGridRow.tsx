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
import { ColumnDescriptor } from '../classes/dataGridInstance.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * DataGridRowProps interface.
 */
interface DataGridRowProps {
	height: number;
	pinned: boolean;
	pinnedColumnDescriptors: ColumnDescriptor[];
	rowIndex: number;
	top: number;
	unpinnedColumnDescriptors: ColumnDescriptor[];
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

	// The data grid row cell elements.
	const dataGridRowCells: JSX.Element[] = [];

	// Render the pinned data grid row cells.
	let pinnedWidth = 0;
	if (context.instance.columnPinning) {
		// Get the pinned column descriptors.
		const pinnedColumnDescriptors = context.instance.getPinnedColumnDescriptors();

		// Enumerate the pinned column descriptors.
		for (const pinnedColumnDescriptor of pinnedColumnDescriptors) {
			// Push the pinned column header element to the array.
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

			// Adjust the pinned width.
			pinnedWidth += pinnedColumnDescriptor.width;
		}
	}

	// Create the unpinned data grid column header elements.
	for (const unpinnedColumnDescriptor of props.unpinnedColumnDescriptors) {
		// Push the unpinned column header element to the array.
		dataGridRowCells.push(
			<DataGridRowCell
				key={`row-cell-${props.rowIndex}-${unpinnedColumnDescriptor.columnIndex}`}
				columnIndex={unpinnedColumnDescriptor.columnIndex}
				height={props.height}
				left={pinnedWidth + unpinnedColumnDescriptor.left - context.instance.horizontalScrollOffset}
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
