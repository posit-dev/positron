/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataGridColumnHeaders';

// React.
import * as React from 'react';

// Other dependencies.
import { usePositronDataGridContext } from 'vs/workbench/browser/positronDataGrid/positronDataGridContext';
import { DataGridColumnHeader } from 'vs/workbench/browser/positronDataGrid/components/dataGridColumnHeader';

// Other dependencies.

/**
 * DataGridColumnHeadersProps interface.
 */
interface DataGridColumnHeadersProps {
	width: number;
	height: number;
}

/**
 * DataGridColumnHeaders component.
 * @param props A DataGridColumnHeadersProps that contains the component properties.
 * @returns The rendered component.
 */
export const DataGridColumnHeaders = (props: DataGridColumnHeadersProps) => {
	// Context hooks.
	const context = usePositronDataGridContext();

	// Create the data grid column headers.
	const dataGridColumnHeaders: JSX.Element[] = [];
	if (context.instance.columns) {
		// Get the first column.
		let { left, columnIndex } = context.instance.firstColumn;

		// Create the data grid column headers.
		const right = context.instance.horizontalScrollOffset + context.instance.layoutWidth;
		while (left < right && columnIndex < context.instance.columns) {
			// Get the column.
			const column = context.instance.column(columnIndex);
			if (!column) {
				break;
			}

			// Create and add the data grid column header.
			dataGridColumnHeaders.push(
				<DataGridColumnHeader
					key={columnIndex}
					column={column}
					columnIndex={columnIndex}
					left={left - context.instance.horizontalScrollOffset}
				/>
			);

			// Get the column width.
			const columnWidth = context.instance.getColumnWidth(columnIndex);
			if (!columnWidth) {
				break;
			}

			// Advance to the next column.
			columnIndex++;
			left += columnWidth;
		}
	}

	// Render.
	return (
		<div className='data-grid-column-headers' style={{ height: props.height }}>
			{dataGridColumnHeaders}
		</div>
	);
};
