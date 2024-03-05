/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataExplorerPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { StatusBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/statusBar';
import { FilterBars } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/filterBars';
import { DataExplorer } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/dataExplorer';

/**
 * DataExplorerPanel component.
 * @returns The rendered component.
 */
export const DataExplorerPanel = () => {
	// Render.
	return (
		<div className='data-explorer-panel'>
			<FilterBars />
			<DataExplorer />
			<StatusBar />
		</div>
	);
};
