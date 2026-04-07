/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronData.css';

// Other dependencies.
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { DataTab, DataTabSelector } from './components/dataTabSelector.js';
import { useState } from 'react';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * PositronDataProps interface.
 */
interface PositronDataProps {
	// A container that allows the component to save and restore scroll position.
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronData component.
 */
export const PositronData = (props: PositronDataProps) => {
	// State.
	const [selectedDataTab, setSelectedDataTab] = useState(DataTab.Connections);

	// Render.
	return (
		<div className='positron-data'>
			<DataTabSelector
				selectedDataTab={selectedDataTab}
				onDataTabChanged={(dataTab: DataTab) => setSelectedDataTab(dataTab)}
			/>
			<div className='data-panels'>
				<div className={positronClassNames('data-panel', { 'active': selectedDataTab === DataTab.Connections })}>
					<div className='temporary-label'>Data Connections Panel</div>
				</div>
				<div className={positronClassNames('data-panel', { 'active': selectedDataTab === DataTab.Explorer })}>
					<div className='temporary-label'>Data Explorer Panel</div>
				</div>
			</div>
		</div>
	);
};
