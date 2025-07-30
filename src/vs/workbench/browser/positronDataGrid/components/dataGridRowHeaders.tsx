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
import { usePositronDataGridContext } from '../positronDataGridContext.js';
import { RowDescriptors } from '../classes/dataGridInstance.js';

/**
 * DataGridRowHeadersProps interface.
 */
interface DataGridRowHeadersProps {
	height: number;
	rowDescriptors: RowDescriptors;
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
	const dataGridRowHeaders: JSX.Element[] = [];
	for (const pinnedRowDescriptor of props.rowDescriptors.pinnedRowDescriptors) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={`pinned-row-${pinnedRowDescriptor.rowIndex}`}
				height={pinnedRowDescriptor.height}
				pinned={true}
				rowIndex={pinnedRowDescriptor.rowIndex}
				top={pinnedRowDescriptor.top}
			/>
		);
	}

	// Create the unpinned data grid row header elements.
	for (const unpinnedRowDescriptor of props.rowDescriptors.unpinnedRowDescriptors) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={`unpinned-row-${unpinnedRowDescriptor.rowIndex}`}
				height={unpinnedRowDescriptor.height}
				pinned={false}
				rowIndex={unpinnedRowDescriptor.rowIndex}
				top={unpinnedRowDescriptor.top - context.instance.verticalScrollOffset}
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
