/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataExplorerPanel.css';

// React.
import React from 'react';

// Other dependencies.
import { StatusBar } from './components/statusBar.js';
import { DataExplorer } from './components/dataExplorer.js';
import { RowFilterBar } from './components/rowFilterBar/rowFilterBar.js';

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
