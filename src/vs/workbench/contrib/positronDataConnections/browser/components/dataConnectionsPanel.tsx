/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsPanel.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { NewDataConnectionFlow } from '../dialogs/newDataConnectionFlow.js';
import { PositronTree } from '../../../../browser/positronTree/positronTree.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { DataConnectionsTreeInstance } from '../classes/dataConnectionsTreeInstance.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { DEFAULT_ACTION_BAR_BUTTON_WIDTH, DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * DataConnectionsPanelProps interface.
 */
interface DataConnectionsPanelProps {
	// Whether the panel is active.
	active: boolean;
}

/**
 * DataConnectionsPanel component. Hosts the data connections tree -- active instances are
 * shown first (expandable to schemas / tables via the connection's handle), then persisted
 * profiles (leaves; "connect to use" runs through each profile's actions menu).
 */
export const DataConnectionsPanel = ({ active }: DataConnectionsPanelProps) => {
	// Context.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// Tree instance. Constructed once per mount; the instance subscribes to the service's
	// onDidChangeInstances / onDidChangeProfiles internally and pushes new roots itself, so
	// no React effect is needed to keep it in sync.
	const [treeInstance] = useState(() => new DataConnectionsTreeInstance(positronDataConnectionsService));

	// Dispose the tree instance on unmount.
	useEffect(() => () => treeInstance.dispose(), [treeInstance]);

	// Left action bar actions.
	const leftActions: DynamicActionBarAction[] = [];

	// Right action bar actions.
	const rightActions: DynamicActionBarAction[] = [];

	// Add connection.
	const addConnection = localize('positronDataConnections.addConnection', "Add Connection");
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				ariaLabel={addConnection}
				disabled={false}
				icon={ThemeIcon.fromId('positron-add-connection')}
				tooltip={addConnection}
				onPressed={() => {
					const renderer = new PositronModalDialogReactRenderer();
					renderer.render(
						<NewDataConnectionFlow
							renderer={renderer}
						/>
					);
				}}
			/>
		)
	});

	// Render.
	return (
		<div
			className={positronClassNames(
				'data-connections-panel',
				{ 'active': active }
			)}
			id='data-connections-panel'
			role='tabpanel'
		>
			<PositronActionBarContextProvider>
				<PositronDynamicActionBar
					borderBottom={true}
					borderTop={true}
					leftActions={leftActions}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					rightActions={rightActions}
				/>
			</PositronActionBarContextProvider>
			<div className='data-connection-profiles-list'>
				<PositronTree
					emptyTreeRenderer={() =>
						<div className='no-data-connections'>
							{localize('positronDataConnections.noConnections', "No data connections.")}
						</div>
					}
					id='data-connection-profiles-list'
					instance={treeInstance}
				/>
			</div>
		</div>
	);
};
