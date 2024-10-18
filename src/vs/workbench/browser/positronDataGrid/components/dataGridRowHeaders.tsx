/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridRowHeaders';

// React.
import * as React from 'react';

// Other dependencies.
import { DataGridRowHeader } from 'vs/workbench/browser/positronDataGrid/components/dataGridRowHeader';
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';

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

	// Create the data grid row headers.
	const dataGridRowHeaders: JSX.Element[] = [];
	if (context.instance.rows) {
		// Get the first row.
		let { rowIndex, top } = context.instance.firstRow;

		// Create the data grid rows headers.
		const bottom = context.instance.verticalScrollOffset + context.instance.layoutHeight;
		while (rowIndex < context.instance.rows && top < bottom) {
			// Create and add the data grid row header.
			dataGridRowHeaders.push(
				<DataGridRowHeader
					key={rowIndex}
					rowIndex={rowIndex}
					top={top - context.instance.verticalScrollOffset}
				/>
			);

			// Get the row height and advance to the next data grid row.
			const rowHeight = context.instance.getRowHeight(rowIndex);
			if (!rowHeight) {
				break;
			}

			// Advance to the next data grid row.
			rowIndex++;
			top += rowHeight;
		}
	}

	// Render.
	return (
		<div className='data-grid-row-headers' style={{ width: context.instance.rowHeadersWidth }}>
			{dataGridRowHeaders}
		</div>
	);
};
