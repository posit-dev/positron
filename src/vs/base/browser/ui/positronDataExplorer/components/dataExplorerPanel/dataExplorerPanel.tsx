/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./dataExplorerPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { FilterBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/filterBar';
import { StatusBar } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/statusBar';
import { DataExplorer } from 'vs/base/browser/ui/positronDataExplorer/components/dataExplorerPanel/components/dataExplorer';

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
