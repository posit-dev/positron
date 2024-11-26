/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataGridRowHeaders.css';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridRowHeader } from './dataGridRowHeader.js';
import { usePositronDataGridContext } from '../positronDataGridContext.js';

/**
 * DataGridRowHeadersProps interface.
 */
interface DataGridRowHeadersProps {
	height: number;
}

/**
 * DataGridRowHeaders component.
 * @param props A DataGridRowHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridRowHeaders = (props: DataGridRowHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Create the data grid rows headers.
	const dataGridRowHeaders: JSX.Element[] = [];
	for (let rowDescriptor = context.instance.firstRow;
		rowDescriptor && rowDescriptor.top < context.instance.layoutBottom;
		rowDescriptor = context.instance.getRow(rowDescriptor.rowIndex + 1)
	) {
		dataGridRowHeaders.push(
			<DataGridRowHeader
				key={rowDescriptor.rowIndex}
				rowIndex={rowDescriptor.rowIndex}
				top={rowDescriptor.top - context.instance.verticalScrollOffset}
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
