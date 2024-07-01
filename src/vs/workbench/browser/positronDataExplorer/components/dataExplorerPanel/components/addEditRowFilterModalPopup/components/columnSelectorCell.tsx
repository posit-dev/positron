/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSelectorCell';

// React.
import * as React from 'react';

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { ColumnSchema } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { columnSchemaDataTypeIcon } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/utility/columnSchemaUtilities';
import { ColumnSelectorDataGridInstance } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/components/columnSelectorDataGridInstance';

/**
 * ColumnSummaryCellProps interface.
 */
interface ColumnSelectorCellProps {
	instance: ColumnSelectorDataGridInstance;
	columnSchema: ColumnSchema;
	columnIndex: number;
	onPressed: () => void;
}

/**
 * ColumnCell component.
 * @param props A ColumnSummaryCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSelectorCell = (props: ColumnSelectorCellProps) => {
	// Render.
	return (
		<Button className='column-selector-cell' onPressed={props.onPressed}>
			{props.columnIndex === props.instance.cursorRowIndex &&
				<div className='cursor-background' />
			}
			<div className='info'>
				<div className={`data-type-icon codicon ${columnSchemaDataTypeIcon(props.columnSchema)}`}></div>
				<div className='column-name'>
					{props.columnSchema.column_name}
				</div>
			</div>
		</Button>
	);
};
