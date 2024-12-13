/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './rowFilterWidget.css';

// React.
import React, { forwardRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../../nls.js';
import { Button } from '../../../../../../../../base/browser/ui/positronComponents/button/button.js';
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
import { RowFilterCondition } from '../../../../../../../services/languageRuntime/common/positronDataExplorerComm.js';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilterDescriptor;
	booleanOperator?: RowFilterCondition;
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
					{localize('positron.dataExplorer.rowFilterWidget.isNull', "is null")}
				</span>
			</>;
		} else if (props.rowFilter instanceof RowFilterDescriptorIsNotNull) {
			return <>
				<span className='column-name'>{props.rowFilter.schema.column_name}</span>
				<span className='space-before'>
					{localize('positron.dataExplorer.rowFilterWidget.isNotNull', "is not null")}
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
			onPressed={() => props.onEdit()}
		>
			{props.booleanOperator &&
				<div className='boolean-operator'>
					{props.rowFilter.props.condition === RowFilterCondition.And ?
						localize('positron.dataExplorer.rowFilterWidget.and', "and") :
						localize('positron.dataExplorer.rowFilterWidget.or', "or")
					}
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
