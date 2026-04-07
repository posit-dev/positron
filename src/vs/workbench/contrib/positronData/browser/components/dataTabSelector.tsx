/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataTabSelector.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { DataTabButton } from './dataTabButton.js';

/**
 * DataTab enum.
 */
export enum DataTab {
	// Connections data tab.
	Connections,

	// Explorer data tab.
	Explorer
}

/**
 * DataTabSelectorProps interface.
 */
interface DataTabSelectorProps {
	// The currently selected data tab.
	readonly selectedDataTab: DataTab;

	// A callback that is called when the tab changes.
	readonly onDataTabChanged: (dataTab: DataTab) => void;
}

/**
 * DataTabSelector component.
 */
export const DataTabSelector = ({ selectedDataTab, onDataTabChanged }: DataTabSelectorProps) => {
	// Render.
	return (
		<div className='data-tab-selector'>
			<DataTabButton
				active={selectedDataTab === DataTab.Connections}
				label={localize('dataTabSelector.connections', "Connections")}
				onPressed={() => onDataTabChanged(DataTab.Connections)}
			/>
			<DataTabButton
				active={selectedDataTab === DataTab.Explorer}
				label={localize('dataTabSelector.explorer', "Explorer")}
				onPressed={() => onDataTabChanged(DataTab.Explorer)}
			/>
		</div>
	);
};
