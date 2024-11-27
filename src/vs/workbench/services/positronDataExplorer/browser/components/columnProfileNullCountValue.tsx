/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnProfileNullCountValue.css';

// React.
import React from 'react';

// Other dependencies.
import { TableSummaryDataGridInstance } from '../tableSummaryDataGridInstance.js';

/**
 * ColumnProfileNullCountValueProps interface.
 */
interface ColumnProfileNullCountValueProps {
	instance: TableSummaryDataGridInstance;
	columnIndex: number;
}

/**
 * ColumnProfileNullCountValue component.
 * @param props A ColumnProfileNullCountValueProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnProfileNullCountValue = (props: ColumnProfileNullCountValueProps) => {
	// Get the column profile null count.
	const columnProfileNullCount = props.instance.getColumnProfileNullCount(props.columnIndex);

	// Render placeholder.
	if (columnProfileNullCount === undefined) {
		return (
			<div className='value-placeholder'>&#x22ef;</div>
		);
	}

	// Render value.
	return (
		<div className='value'>{columnProfileNullCount}</div>
	);
};
