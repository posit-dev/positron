/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataColumn } from '../../src/positron-data-viewer';

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
	const headerRows = data.map((column) => {
		return <th>{column.name}</th>;
	});

	// Create the data rows.
	const dataRows = data[0].data.map((_row, rowIndex) => {
		return (
			<tr>
				{data.map((column) => {
					return <td>{column.data[rowIndex]}</td>;
				})}
			</tr>
		);
	});

	return (
		<table>
			<thead>
				{headerRows}
			</thead>
			<tbody>
				{dataRows}
			</tbody>
		</table>
	);
};
