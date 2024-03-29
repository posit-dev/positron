/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterWidget';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';
import { RowFilter, RowFilterIsBetween, RowFilterIsEmpty, RowFilterIsEqualTo, RowFilterIsGreaterThan, RowFilterIsLessThan, RowFilterIsNotBetween, RowFilterIsNotEmpty } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilter;
	onClear: () => void;
}

/**
 * RowFilterWidget component.
 * @param props A RowFilterWidgetProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowFilterWidget = (props: RowFilterWidgetProps) => {
	// Compute the title.
	const title = (() => {
		if (props.rowFilter instanceof RowFilterIsEmpty) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isEmpty',
				"{0} is empty",
				props.rowFilter.columnSchema.column_name
			);
		} else if (props.rowFilter instanceof RowFilterIsNotEmpty) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isNotEmpty',
				"{0} is not empty",
				props.rowFilter.columnSchema.column_name
			);
		} else if (props.rowFilter instanceof RowFilterIsLessThan) {
			return `${props.rowFilter.columnSchema.column_name} < ${props.rowFilter.value}`;
		} else if (props.rowFilter instanceof RowFilterIsGreaterThan) {
			return `${props.rowFilter.columnSchema.column_name} > ${props.rowFilter.value}`;
		} else if (props.rowFilter instanceof RowFilterIsEqualTo) {
			return `${props.rowFilter.columnSchema.column_name} = ${props.rowFilter.value}`;
		} else if (props.rowFilter instanceof RowFilterIsBetween) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isBetween',
				"{0} >= {1} AND {2} <= {3}",
				props.rowFilter.columnSchema.column_name,
				props.rowFilter.lowerLimit,
				props.rowFilter.columnSchema.column_name,
				props.rowFilter.upperLimit
			);
		} else if (props.rowFilter instanceof RowFilterIsNotBetween) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isNotBetween',
				"{0} < {1} AND {2} > {3}",
				props.rowFilter.columnSchema.column_name,
				props.rowFilter.lowerLimit,
				props.rowFilter.columnSchema.column_name,
				props.rowFilter.upperLimit
			);
		} else {
			// This indicates a bug.
			return null;
		}
	})();

	// Render.
	return (
		<Button
			className='row-filter-widget'
			onPressed={() => {
				console.log('Edit row filter');
			}}
		>
			<div className='title-and-condition'>
				{title}
			</div>
			<Button
				className='clear-filter-button'
				onPressed={() => props.onClear()}>
				<div className={'codicon codicon-positron-clear-filter'} />
			</Button>
		</Button>
	);
};
