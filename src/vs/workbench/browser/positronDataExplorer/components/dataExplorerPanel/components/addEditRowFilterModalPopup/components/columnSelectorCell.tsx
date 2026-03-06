/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnSelectorCell.css';

// Other dependencies.
import { Button } from '../../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { ThemeIcon } from '../../../../../../../../platform/positronActionBar/browser/components/icon.js';
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
				<ThemeIcon className='data-type-icon' icon={columnSchemaDataTypeIcon(props.columnSchema)} />
				<div className='column-name'>
					{props.columnSchema.column_name}
				</div>
			</div>
		</Button>
	);
};
