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
import { NewDataConnectionModalDialog } from '../dialogs/newDataConnectionModalDialog.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { DEFAULT_ACTION_BAR_BUTTON_WIDTH, DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

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

	// The data connections service.
	dataConnectionsService: IPositronDataConnectionsService;
}

/**
 * DataConnectionsPanel component.
 */
export const DataConnectionsPanel = ({ active, dataConnectionsService }: DataConnectionsPanelProps) => {
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
					// Create the renderer.
					const renderer = new PositronModalReactRenderer();

					// Show the copy as code dialog.
					renderer.render(
						<NewDataConnectionModalDialog
							dataConnectionsService={dataConnectionsService}
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
