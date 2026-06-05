/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronDataConnections.css';

// Other dependencies.
import { DataConnectionsPanel } from './components/dataConnectionsPanel.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';

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
	// Render.
	return (
		<div className='positron-data-connections'>
			<DataConnectionsPanel />
		</div>
	);
};
