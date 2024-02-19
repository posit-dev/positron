/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSummaryCell';

// React.
import * as React from 'react';

// Other dependencies.
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';

/**
 * ColumnSummaryCellProps interface.
 */
interface ColumnSummaryCellProps {
	columnSchema: ColumnSchema;
}

/**
 * TableDataCell component.
 * @param props A TableDataCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSummaryCell = (props: ColumnSummaryCellProps) => {
	// Render.
	return (
		<div>
			{props.columnSchema.column_name}
		</div>
	);
};
