/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsExplorerPanel.css';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { DEFAULT_ACTION_BAR_BUTTON_WIDTH, DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';

/**
 * Constants.
 */
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * DataConnectionsExplorerPanelProps interface.
 */
interface DataConnectionsExplorerPanelProps {
	// Whether the panel is active.
	active: boolean;
}

/**
 * DataConnectionsExplorerPanel component.
 */
export const DataConnectionsExplorerPanel = ({ active }: DataConnectionsExplorerPanelProps) => {
	// Left action bar actions.
	const leftActions: DynamicActionBarAction[] = [];

	// Right action bar actions.
	const rightActions: DynamicActionBarAction[] = [];

	// Add connection.
	const refresh = localize('positronDataConnections.refresh', "Refresh");
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				ariaLabel={refresh}
				disabled={false}
				icon={ThemeIcon.fromId('positron-refresh')}
				tooltip={refresh}
				onPressed={() => console.log('Refresh pressed')}
			/>
		)
	});

	// Render.
	return (
		<div
			className={positronClassNames(
				'data-connections-explorer-panel',
				{ 'active': active }
			)}
			id='data-connections-explorer-panel'
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
			<div className='temporary-label'>Data Connections Explorer Panel</div>
		</div>
	);
};
