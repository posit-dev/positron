/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './rowFilterWidget.css';

// React.
import React, { forwardRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../../nls.js';
import { Button } from '../../../../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronDataExplorerContext } from '../../../../../positronDataExplorerContext.js';
import {
	RowFilterDescriptor,
	RowFilterDescriptorComparison,
	RowFilterDescriptorIsBetween,
	RowFilterDescriptorIsEmpty,
	RowFilterDescriptorIsFalse,
	RowFilterDescriptorIsNotBetween,
	RowFilterDescriptorIsNotEmpty,
	RowFilterDescriptorIsNotNull,
	RowFilterDescriptorIsNull,
	RowFilterDescriptorIsTrue,
	RowFilterDescriptorSearch
} from '../../addEditRowFilterModalPopup/rowFilterDescriptor.js';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilterDescriptor;
	onEdit: () => void;
	onClear: () => void;
}

/**
 * RowFilterWidget component.
 * @param props A RowFilterWidgetProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowFilterWidget = forwardRef<HTMLButtonElement, RowFilterWidgetProps>((props, ref) => {
	const context = usePositronDataExplorerContext();

	// Compute the title.
	const title = (() => {
		if (props.rowFilter instanceof RowFilterDescriptorIsEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isEmpty', "is empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotEmpty) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotEmpty', "is not empty")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNull) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNull', "is missing")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotNull) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotNull', "is not missing")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsTrue) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isTrue', "is true")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsFalse) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isFalse', "is false")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorComparison) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>{props.rowFilter.operatorText}</span>
				<span className='column-value'>{props.rowFilter.value}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorSearch) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>{props.rowFilter.operatorText}</span>
				<span className='column-value'>&quot;{props.rowFilter.value}&quot;</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsBetween) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>&gt;=</span>
				<span className='column-value'>{props.rowFilter.lowerLimit}</span>
				<span className='space-before space-after'>
					{localize('positron.dataExplorer.rowFilterWidget.and', "and")}
				</span>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>&lt;=</span>
				<span className='column-value'>{props.rowFilter.upperLimit}</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotBetween) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>&lt;</span>
				<span className='column-value'>{props.rowFilter.lowerLimit}</span>
				<span className='space-before space-after'>
					{localize('positron.dataExplorer.rowFilterWidget.and', "and")}
				</span>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before space-after'>&gt;</span>
				<span className='column-value'>{props.rowFilter.upperLimit}</span>
			</>;
		} else {
			// This indicates a bug.
			return null;
		}
	})();

	let buttonClass = 'row-filter-widget';
	if (props.rowFilter.props.isValid === false) {
		buttonClass = `${buttonClass} invalid-row-filter-widget`;
	}

	// Render.
	return (
		<Button
			ref={ref}
			className={buttonClass}
			hoverManager={context.instance.tableDataDataGridInstance.hoverManager}
			tooltip={localize('positron.dataExplorer.editFilter', "Edit Filter")}
			onPressed={() => props.onEdit()}
		>
			<div className='title'>
				{title}
			</div>
			<Button
				className='clear-filter-button'
				hoverManager={context.instance.tableDataDataGridInstance.hoverManager}
				tooltip={localize('positron.dataExplorer.clearFilter', "Clear Filter")}
				onPressed={() => props.onClear()}>
				<div className={'codicon codicon-positron-clear-filter'} />
			</Button>
		</Button>
	);
});

// Set the display name.
RowFilterWidget.displayName = 'RowFilterWidget';
