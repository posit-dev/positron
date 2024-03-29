/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataExplorerPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { StatusBar } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/statusBar';
import { DataExplorer } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/dataExplorer';
import { FilterBar } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/filterBar/filterBar';

/**
 * DataExplorerPanel component.
 * @returns The rendered component.
 */
export const DataExplorerPanel = () => {
	// Render.
	return (
		<div className='data-explorer-panel'>
			<FilterBar />
			<DataExplorer />
			<StatusBar />
		</div>
	);
};
