/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsTabSelector.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataTabButton } from './dataConnectionsTabButton.js';

/**
 * DataConnectionsTab enum.
 */
export enum DataConnectionsTab {
	// DataConnections tab.
	DataConnections,

	// DataConnectionsExplorer tab.
	DataConnectionsExplorer
}

/**
 * DataConnectionsTabSelectorProps interface.
 */
interface DataConnectionsTabSelectorProps {
	// The selected data connections tab.
	readonly selectedDataConnectionsTab: DataConnectionsTab;

	// A callback that is called when the tab changes.
	readonly onDataTabChanged: (dataTab: DataConnectionsTab) => void;
}

/**
 * DataConnectionsTabSelector component.
 */
export const DataConnectionsTabSelector = ({ selectedDataConnectionsTab, onDataTabChanged }: DataConnectionsTabSelectorProps) => {
	// Render.
	return (
		<div className='data-connections-tab-selector' role='tablist'>
			<DataTabButton
				active={selectedDataConnectionsTab === DataConnectionsTab.DataConnections}
				ariaControls='data-connections-panel'
				label={localize('dataTabSelector.connections', "Connections")}
				onPressed={() => onDataTabChanged(DataConnectionsTab.DataConnections)}
			/>
			<DataTabButton
				active={selectedDataConnectionsTab === DataConnectionsTab.DataConnectionsExplorer}
				ariaControls='data-connections-explorer-panel'
				label={localize('dataTabSelector.explorer', "Explorer")}
				onPressed={() => onDataTabChanged(DataConnectionsTab.DataConnectionsExplorer)}
			/>
		</div>
	);
};
