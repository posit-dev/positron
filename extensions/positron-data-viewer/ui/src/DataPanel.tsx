/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

interface DataColumn {
	name: string;
	type: string;
	data: Array<any>;
}

interface DataPanelProps {
	data: Array<DataColumn>;
}

export const DataPanel = (props: DataPanelProps) => {
	// Extract the data from the props.
	const data = props.data;

	// Create the header row.
	const headerRows = data.map((column) => {
		return <th>{column.name}</th>;
	});

	return (
		<table>
			<thead>
				{headerRows}
			</thead>
		</table>
	);
};
