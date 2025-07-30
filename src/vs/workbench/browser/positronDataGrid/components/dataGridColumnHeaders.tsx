/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridColumnHeaders.css';

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { DataGridColumnHeader } from './dataGridColumnHeader.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { ColumnDescriptor } from '../classes/dataGridInstance.js';

// Other dependencies.

/**
 * DataGridColumnHeadersProps interface.
 */
interface DataGridColumnHeadersProps {
	height: number;
	pinnedColumnDescriptors: ColumnDescriptor[]
	unpinnedColumnDescriptors: ColumnDescriptor[];
	width: number;
}

/**
 * DataGridColumnHeaders component.
 * @param props A DataGridColumnHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridColumnHeaders = (props: DataGridColumnHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Create the pinned data grid column header elements.
	let pinnedWidth = 0;
	const dataGridColumnHeaders: JSX.Element[] = [];
	for (const pinnedColumnDescriptor of props.pinnedColumnDescriptors) {
		// Push the pinned column header element to the array.
		dataGridColumnHeaders.push(
			<DataGridColumnHeader
				key={`pinned-column-header-${pinnedColumnDescriptor.columnIndex}`}
				column={context.instance.column(pinnedColumnDescriptor.columnIndex)}
				columnIndex={pinnedColumnDescriptor.columnIndex}
				left={pinnedColumnDescriptor.left}
				pinned={true}
				width={pinnedColumnDescriptor.width}
			/>
		);

		// Adjust the pinned width.
		pinnedWidth += pinnedColumnDescriptor.width;
	}

	// Create the unpinned data grid column header elements.
	for (const unpinnedColumnDescriptor of props.unpinnedColumnDescriptors) {
		// Push the unpinned column header element to the array.
		dataGridColumnHeaders.push(
			<DataGridColumnHeader
				key={`unpinned-column-header-${unpinnedColumnDescriptor.columnIndex}`}
				column={context.instance.column(unpinnedColumnDescriptor.columnIndex)}
				columnIndex={unpinnedColumnDescriptor.columnIndex}
				left={pinnedWidth + unpinnedColumnDescriptor.left - context.instance.horizontalScrollOffset}
				pinned={false}
				width={unpinnedColumnDescriptor.width}
			/>
		);
	}

	// Render.
	return (
		<div className='data-grid-column-headers' style={{ height: props.height }}>
			{dataGridColumnHeaders}
		</div>
	);
};
