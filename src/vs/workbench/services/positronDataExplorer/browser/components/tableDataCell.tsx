/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./tableDataCell';

// React.
import * as React from 'react';

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { DataCell, DataCellKind } from 'vs/workbench/services/positronDataExplorer/common/tableDataCache';
import { PositronDataExplorerColumn } from 'vs/workbench/services/positronDataExplorer/browser/positronDataExplorerColumn';

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
	// Set the class names.
	const classNames = positronClassNames(
		'text-value',
		{ 'special-value': props.dataCell.kind !== DataCellKind.NON_NULL }
	);

	// Render.
	return (
		<div className={positronClassNames('text-container', props.column.alignment)}>
			<div className={classNames}>
				{props.dataCell.formatted.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}
			</div>
		</div>
	);
};
