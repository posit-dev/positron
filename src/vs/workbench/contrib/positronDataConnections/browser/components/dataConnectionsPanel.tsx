/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionsPanel.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { NewDataConnectionFlow } from '../dialogs/newDataConnectionFlow.js';
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
 * DataConnectionsPanel component.
 */
export const DataConnectionsPanel = ({ active }: DataConnectionsPanelProps) => {
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
			<div className='temporary-label'>Data Connections Panel</div>
		</div>
	);
};
