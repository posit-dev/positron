/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./tableDataCell';

// React.
import * as React from 'react';

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';
import { DataCell } from 'vs/workbench/services/positronDataExplorer/common/dataExplorerCache';

/**
 * TableDataCellProps interface.
 */
interface TableDataCellProps {
	column: PositronDataExplorerColumn;
	dataCell: DataCell;
}

/**
 * TableDataCell component.
 * @param props A TableDataCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const TableDataCell = (props: TableDataCellProps) => {
	// Render.
	return (
		<div className={positronClassNames('text-container', props.column.alignment)}>
			<div className='text-value'>
				{props.dataCell.formatted.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}
			</div>
		</div>
	);
};
