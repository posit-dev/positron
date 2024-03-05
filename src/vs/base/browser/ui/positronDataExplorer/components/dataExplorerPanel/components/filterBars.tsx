/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./filterBars';

// React.
import * as React from 'react';

// Other dependencies.
import { localize } from 'vs/nls';
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
import { FilterBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/filterBar';

/**
 * Localized strings.
 */
const filterTypeLabelColumn = localize('positron.colum', "column");
const filterTypeLabelRow = localize('positron.colum', "column");
const columnFiltering = localize('positron.columnFiltering', "Column filtering");
const rowFiltering = localize('positron.rowFiltering', "Row filtering");

/**
 * FilterBars component.
 * @returns The rendered component.
 */
export const FilterBars = () => {
	// Context hooks.
	const context = usePositronDataExplorerContext();

	console.log(context.instance.layout);

	// Render.
	return (
		<div className='filter-bars'>
			<FilterBar
				filterTypeLabel={filterTypeLabelColumn}
				filterTypeIconId='positron-column-filter'
				filterTypeAriaLabel={columnFiltering}
			/>
			<FilterBar
				filterTypeLabel={filterTypeLabelRow}
				filterTypeIconId='positron-row-filter'
				filterTypeAriaLabel={rowFiltering}
			/>
		</div>
	);
};
