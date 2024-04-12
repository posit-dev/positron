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
import {
	RowFilterDescriptor,
	RowFilterDescriptorIsBetween,
	RowFilterDescriptorIsEmpty,
	RowFilterDescriptorIsEqualTo,
	RowFilterDescriptorIsGreaterThan,
	RowFilterDescriptorIsGreaterOrEqual,
	RowFilterDescriptorIsLessThan,
	RowFilterDescriptorIsLessOrEqual,
	RowFilterDescriptorIsNotBetween,
	RowFilterDescriptorIsNotEmpty,
	RowFilterDescriptorIsNotNull,
	RowFilterDescriptorIsNull
} from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilterDescriptor';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilterDescriptor;
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
		if (props.rowFilter instanceof RowFilterDescriptorIsEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isEmpty', "is empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotEmpty', "is not empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNull) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNull', "is null")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotNull) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotNull', "is not null")}
				</span>
			</>;

		} else if (props.rowFilter instanceof RowFilterDescriptorIsLessThan) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&lt;</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsLessOrEqual) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&lt;=</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsGreaterThan) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&gt;</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsGreaterOrEqual) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>&gt;=</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsEqualTo) {
			return <>
				<span className='column-name'>{props.rowFilter.columnSchema.column_name}</span>
				<span className='space-before space-after'>=</span>
				<span>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsBetween) {
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
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotBetween) {
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
