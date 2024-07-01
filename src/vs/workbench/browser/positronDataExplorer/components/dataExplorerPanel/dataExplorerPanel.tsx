/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./dataExplorerPanel';

// React.
import * as React from 'react';

// Other dependencies.
import { StatusBar } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/statusBar';
import { DataExplorer } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/dataExplorer';
import { RowFilterBar } from 'vs/workbench/browser/positronDataExplorer/components/dataExplorerPanel/components/rowFilterBar/rowFilterBar';

/**
 * DataExplorerPanel component.
 * @returns The rendered component.
 */
export const DataExplorerPanel = () => {
	// Render.
	return (
		<div className='data-explorer-panel'>
			<RowFilterBar />
			<DataExplorer />
			<StatusBar />
		</div>
	);
};
