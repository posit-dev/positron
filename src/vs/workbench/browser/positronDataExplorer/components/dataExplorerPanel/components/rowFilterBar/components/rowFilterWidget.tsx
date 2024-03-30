/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterWidget';

// React.
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { RowFilter, RowFilterIsBetween, RowFilterIsEmpty, RowFilterIsEqualTo, RowFilterIsGreaterThan, RowFilterIsLessThan, RowFilterIsNotBetween, RowFilterIsNotEmpty } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilter;
	booleanOperator?: 'and';
	onEdit: () => void;
	onClear: () => void;
}

/**
 * RowFilterWidget component.
 * @param props A RowFilterWidgetProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowFilterWidget = forwardRef<HTMLButtonElement, RowFilterWidgetProps>((props, ref) => {
	// Compute the title.
	const title = (() => {
		if (props.rowFilter instanceof RowFilterIsEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isEmpty', "is empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsNotEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotEmpty', "is not empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsLessThan) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&lt;</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsGreaterThan) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&gt;</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsEqualTo) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>=</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsBetween) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&gt;=</span>
				<span>{props.rowFilter.lowerLimit}</span>
				<span className='space-before space-after'>
					{localize('positron.dataExplorer.rowFilterWidget.and', "and")}
				</span>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&lt;=</span>
				<span>{props.rowFilter.upperLimit}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterIsNotBetween) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&lt;</span>
				<span>{props.rowFilter.lowerLimit}</span>
				<span className='space-before space-after'>
					{localize('positron.dataExplorer.rowFilterWidget.and', "and")}
				</span>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&gt;</span>
				<span>{props.rowFilter.upperLimit}</span>
			</>;
		} else {
			// This indicates a bug.
			return null;
		}
	})();

	// Render.
	return (
		<Button
			ref={ref}
			className='row-filter-widget'
			onPressed={() => props.onEdit()}
		>
			{props.booleanOperator &&
				<div className='boolean-operator'>
					{localize('positron.dataExplorer.rowFilterWidget.and', "and")}
				</div>
			}
			<div className='title'>
				{title}
			</div>
			<Button
				className='clear-filter-button'
				onPressed={() => props.onClear()}>
				<div className={'codicon codicon-positron-clear-filter'} />
			</Button>
		</Button>
	);
});

// Set the display name.
RowFilterWidget.displayName = 'RowFilterWidget';
