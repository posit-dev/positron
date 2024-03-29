/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterWidget';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { RowFilter, RowFilterIsEmpty, RowFilterIsNotEmpty } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/addEditRowFilterModalPopup/rowFilter';

/**
 * RowFilterWidgetProps interface.
 */
interface RowFilterWidgetProps {
	rowFilter: RowFilter;
}

/**
 * RowFilterWidget component.
 * @param props A RowFilterWidgetProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowFilterWidget = (props: RowFilterWidgetProps) => {
	/**
	 * Returns the condition.
	 * @returns The condition.
	 */
	const condition = () => {
		if (props.rowFilter instanceof RowFilterIsEmpty) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isEmpty',
				"is empty"
			);
		} else if (props.rowFilter instanceof RowFilterIsNotEmpty) {
			return localize(
				'positron.dataExplorer.rowFilterWidget.isNotEmpty',
				"is not empty"
			);
		} else {
			return '';
		}
	};

	// Render.
	return (
		<div className='row-filter-widget'>
			<div className='title-and-condition'>
				{props.rowFilter.columnSchema.column_name} {condition()}
			</div>
		</div>
	);
};
