/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataColumn } from './positron-data-viewer';
import './DataPanel.css';

interface DataPanelProps {
	data: Array<DataColumn>;
}

/**
 * React component that displays a tabular data panel.
 *
 * @param props The properties for the component.
 */
export const DataPanel = (props: DataPanelProps) => {
	// Extract the data from the props.
	const data = props.data;

	// Create the header row.
	const headerColumns = data.map((column) => {
		return <th key={column.name}>{column.name}</th>;
	});

	// Create the data rows.
	const dataRows = data[0].data.map((_row, rowIndex) => {
		return (
			<tr key={'row_' + rowIndex}>
				{data.map((column) => {
					return <td className={'col-' + column.type} key={column.name + '_' + rowIndex}>
						{column.data[rowIndex]}
					</td>;
				})}
			</tr>
		);
	});

	return (
		<table>
			<thead>
				<tr>
					{headerColumns}
				</tr>
			</thead>
			<tbody>
				{dataRows}
			</tbody>
		</table>
	);
};
