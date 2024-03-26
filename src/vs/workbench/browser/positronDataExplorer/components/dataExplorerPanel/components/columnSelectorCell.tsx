/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSelectorCell';

// React.
import * as React from 'react';

// Other dependencies.
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { ColumnSelectorDataGridInstance } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/columnSelectorDataGridInstance';

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
	/**
	 * Returns the data type icon for the column schema.
	 * @returns The data type icon.
	 */
	const dataTypeIcon = () => {
		// Determine the alignment based on type.
		switch (props.columnSchema.type_display) {
			case ColumnSchemaTypeDisplay.Number:
				return 'codicon-positron-data-type-number';

			case ColumnSchemaTypeDisplay.Boolean:
				return 'codicon-positron-data-type-boolean';

			case ColumnSchemaTypeDisplay.String:
				return 'codicon-positron-data-type-string';

			case ColumnSchemaTypeDisplay.Date:
				return 'codicon-positron-data-type-date';

			case ColumnSchemaTypeDisplay.Datetime:
				return 'codicon-positron-data-type-date-time';

			case ColumnSchemaTypeDisplay.Time:
				return 'codicon-positron-data-type-time';

			case ColumnSchemaTypeDisplay.Array:
				return 'codicon-positron-data-type-array';

			case ColumnSchemaTypeDisplay.Struct:
				return 'codicon-positron-data-type-struct';

			case ColumnSchemaTypeDisplay.Unknown:
				return 'codicon-positron-data-type-unknown';

			// This shouldn't ever happen.
			default:
				return 'codicon-question';
		}
	};

	// Render.
	return (
		<Button className='column-selector-cell' onPressed={props.onPressed}>
			{props.columnIndex === props.instance.cursorRowIndex &&
				<div className='cursor-background' />
			}
			<div className='info'>
				<div className={`data-type-icon codicon ${dataTypeIcon()}`}></div>
				<div className='column-name'>
					{props.columnSchema.column_name}
				</div>
			</div>
		</Button>
	);
};
