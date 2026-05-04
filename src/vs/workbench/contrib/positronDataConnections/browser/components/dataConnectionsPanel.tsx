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
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { PositronList } from '../../../../browser/positronList/positronList.js';
import { PositronListInstance } from '../../../../browser/positronList/classes/positronListInstance.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';
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
 * DataConnectionsPanel component.
 */
export const DataConnectionsPanel = ({ active }: DataConnectionsPanelProps) => {
	// Access the Positron data connections service.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// Track the data connection profiles so the panel re-renders when they change.
	const [profiles, setProfiles] = useState<readonly IDataConnectionProfile[]>(
		positronDataConnectionsService.getProfiles()
	);

	// Listen for changes to the data connection profiles and update state accordingly.
	useEffect(() => {
		const disposable = positronDataConnectionsService.onDidChangeProfiles(updatedProfiles => {
			setProfiles(updatedProfiles);
		});
		return () => disposable.dispose();
	}, [positronDataConnectionsService]);

	// Single-column list instance for the data connection profiles. Created once and disposed
	// on unmount; props (items, etc.) are pushed in via setters below.
	const [listInstance] = useState(() => new PositronListInstance<IDataConnectionProfile>({
		defaultRowHeight: 32,
		itemRenderer: profile => (
			<div className='data-connection-profile'>
				{profile.connectionName}
			</div>
		),
	}));

	// Push the latest profiles into the list instance.
	useEffect(() => {
		listInstance.setItems(profiles);
	}, [listInstance, profiles]);

	// Dispose the list instance on unmount.
	useEffect(() => () => listInstance.dispose(), [listInstance]);

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
				{profiles.length === 0
					? <div className='data-connection-profiles-list-empty'>
						{localize('positronDataConnections.noConnections', "No data connections.")}
					</div>
					: <PositronList id='data-connection-profiles-list' instance={listInstance} />
				}
			</div>
		</div>
	);
};
