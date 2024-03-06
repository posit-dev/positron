/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./filterBars';

// React.
import * as React from 'react';

// Other dependencies.
import { usePositronDataExplorerContext } from 'vs/base/browser/ui/positronDataExplorer/positronDataExplorerContext';
import { FilterBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/filterBar';

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
			<FilterBar type='column' />
			<FilterBar type='row' />
		</div>
	);
};
