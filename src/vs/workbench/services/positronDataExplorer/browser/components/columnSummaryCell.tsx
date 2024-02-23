/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSummaryCell';

// React.
import * as React from 'react';

// Other dependencies.
import { PositronButton } from 'vs/base/browser/ui/positronComponents/positronButton';
import { ColumnSchema, ColumnSchemaTypeDisplay } from 'vs/workbench/services/languageRuntime/common/positronDataExplorerComm';
import { TableSummaryDataGridInstance } from 'vs/workbench/services/positronDataExplorer/browser/tableSummaryDataGridInstance';

/**
 * ColumnSummaryCellProps interface.
 */
interface ColumnSummaryCellProps {
	instance: TableSummaryDataGridInstance;
	columnSchema: ColumnSchema;
	columnIndex: number;
}

/**
 * ColumnSummaryCell component.
 * @param props A ColumnSummaryCellProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSummaryCell = (props: ColumnSummaryCellProps) => {
	/**
	 * Returns the data type icon for the column schema.
	 * @returns The data type icon.
	 */
	const dataTypeIcon = (): string => {
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

	const expanded = props.instance.isColumnExpanded(props.columnIndex);

	// Render.
	return (
		<div className='column-summary'>
			<div className='basic-info'>
				<PositronButton
					className='expand-collapse-button'
					onPressed={() => props.instance.toggleExpandedColumn(props.columnIndex)}
				>
					{expanded ?
						<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
						<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
					}
				</PositronButton>
				{/*
				<div className='expand-collapse-button' onMouseDown={chevronMouseDownHandler} onMouseUp={chevronMouseUpHandler}>
					{false ?
						<div className={`expand-collapse-icon codicon codicon-chevron-down`} /> :
						<div className={`expand-collapse-icon codicon codicon-chevron-right`} />
					}
				</div>
				*/}
				<div className={`data-type-icon codicon ${dataTypeIcon()}`}></div>
				<div className='column-name'>
					{props.columnSchema.column_name}
				</div>
				<div className='missing-values'>
					29%
				</div>

			</div>
			{expanded &&
				<div className='extended-info'>
					<div className='tabular-info'>
						<div className='left-labels'>
							<div>Mean</div>
							<div>SD</div>
							<div>Min</div>
							<div>q25</div>
							<div>q75</div>
							<div>Max</div>
						</div>
						<div className='left-values'>
							<div>3.55</div>
							<div>0.51</div>
							<div>0.20</div>
							<div>2.24</div>
							<div>5.02</div>
							<div>7.44</div>

						</div>
						<div className='right-labels'>
							<div>Unique</div>
							<div>Missing</div>
						</div>
						<div className='right-values'>
							<div>2.50%</div>
							<div>29.20%</div>

						</div>
					</div>
				</div>
			}
		</div>
	);
};
