/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridRowHeaders.css';

// React.
import React, { JSX } from 'react';

// Other dependencies.
import { DataGridRowHeader } from './dataGridRowHeader.js';
import { RowDescriptor } from '../classes/dataGridInstance.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

/**
 * DataGridRowHeadersProps interface.
 */
interface DataGridRowHeadersProps {
	height: number;
	pinnedRowDescriptors: RowDescriptor[];
	unpinnedRowDescriptors: RowDescriptor[];
}

/**
 * DataGridRowHeaders component.
 * @param props A DataGridRowHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRowHeaders = (props: DataGridRowHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Create the pinned data grid row header elements.
	let pinnedHeight = 0;
	const dataGridRowHeaders: JSX.Element[] = [];
	for (const pinnedRowDescriptor of props.pinnedRowDescriptors) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={`pinned-row-${pinnedRowDescriptor.rowIndex}`}
				height={pinnedRowDescriptor.height}
				pinned={true}
				rowIndex={pinnedRowDescriptor.rowIndex}
				top={pinnedRowDescriptor.top}
			/>
		);

		// Adjust the pinned height.
		pinnedHeight += pinnedRowDescriptor.height;
	}

	// Create the unpinned data grid row header elements.
	for (const unpinnedRowDescriptor of props.unpinnedRowDescriptors) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={`unpinned-row-${unpinnedRowDescriptor.rowIndex}`}
				height={unpinnedRowDescriptor.height}
				pinned={false}
				rowIndex={unpinnedRowDescriptor.rowIndex}
				top={pinnedHeight + unpinnedRowDescriptor.top - context.instance.verticalScrollOffset}
			/>
		);
	}

	// Render.
	return (
		<div className='data-grid-row-headers' style={{ width: context.instance.rowHeadersWidth }}>
			{dataGridRowHeaders}
		</div>
	);
};
