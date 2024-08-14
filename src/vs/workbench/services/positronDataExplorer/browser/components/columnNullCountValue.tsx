/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnNullCountValue';

// React.
import * as React from 'react';

// Other dependencies.
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * ColumnNullCountValueProps interface.
 */
interface ColumnNullCountValueProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnNullCountValue component.
 * @param props A ColumnNullCountValueProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnNullCountValue = (props: ColumnNullCountValueProps) => {
	// Get the column null count.
	const columnNullCount = props.instance.getColumnNullCount(props.columnIndex);

	// Render placeholder.
	if (columnNullCount === undefined) {
		return (
			<div className='value-placeholder'>&#x22ef;</div>
		);
	}

	// Render value.
	return (
		<div className='value'>{columnNullCount}</div>
	);
};
