/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataConnections.css';

// Other dependencies.
import { useState } from 'react';
import { DataConnectionsPanel } from './components/dataConnectionsPanel.js';
import { DataConnectionsExplorerPanel } from './components/dataConnectionsExplorerPanel.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { DataConnectionsTab, DataConnectionsTabSelector } from './components/dataConnectionsTabSelector.js';

/**
 * PositronDataConnectionsProps interface.
 */
interface PositronDataConnectionsProps {
	// A container that allows the component to save and restore scroll position.
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronDataConnections component.
 */
export const PositronDataConnections = (props: PositronDataConnectionsProps) => {
	// State.
	const [selectedDataTab, setSelectedDataTab] = useState(DataConnectionsTab.DataConnections);

	// Render.
	return (
		<div className='positron-data-connections'>
			<DataConnectionsTabSelector
				selectedDataConnectionsTab={selectedDataTab}
				onDataTabChanged={(dataTab: DataConnectionsTab) => setSelectedDataTab(dataTab)}
			/>
			<div className='panels'>
				<DataConnectionsPanel active={selectedDataTab === DataConnectionsTab.DataConnections} />
				<DataConnectionsExplorerPanel active={selectedDataTab === DataConnectionsTab.DataConnectionsExplorer} />
			</div>
		</div>
	);
};
