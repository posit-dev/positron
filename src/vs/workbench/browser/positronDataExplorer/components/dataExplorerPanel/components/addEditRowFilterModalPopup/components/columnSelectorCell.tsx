/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnSelectorCell.css';

// React.
import React from 'react';

// Other dependencies.
import { Button } from '../../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { ColumnSchema } from '../../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';
import { columnSchemaDataTypeIcon } from '../../../utility/columnSchemaUtilities.js';
import { ColumnSelectorDataGridInstance } from './columnSelectorDataGridInstance.js';

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
