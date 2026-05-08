/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionProfile.css';

// React.
import { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsDriver.js';

/**
 * DataConnectionProfileProps interface.
 */
interface DataConnectionProfileProps {
	profile: IDataConnectionProfile;
}

/**
 * DataConnectionProfile component. Renders one saved (persisted) profile row.
 */
export const DataConnectionProfile = ({ profile }: DataConnectionProfileProps) => {
	// Context.
	const { positronDataConnectionsService } = usePositronReactServicesContext();

	// Reference hooks.
	const actionsButtonRef = useRef<HTMLButtonElement>(null);

	/**
	 * Shows the actions menu for this profile.
	 */
	const showActionsMenu = () => {
		if (!actionsButtonRef.current) {
			return;
		}
		showCustomContextMenu({
			anchorElement: actionsButtonRef.current,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'auto',
			entries: [
				new CustomContextMenuItem({
					icon: 'plug',
					label: localize('positronDataConnections.connect', "Connect"),
					onSelected: () => console.log(`Connect: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					label: localize('positronDataConnections.connectWithPython', "Python"),
					onSelected: () => console.log(`Connect with Python: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					label: localize('positronDataConnections.connectWithR', "R"),
					onSelected: () => console.log(`Connect with R: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					label: localize('positronDataConnections.connectWithSQL', "SQL"),
					onSelected: () => console.log(`Connect with SQL: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					icon: 'edit',
					label: localize('positronDataConnections.editConnection', "Edit Connection"),
					onSelected: () => console.log(`Edit Connection: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					icon: 'trash',
					label: localize('positronDataConnections.remove', "Remove"),
					onSelected: () => positronDataConnectionsService.removeProfile(profile.id),
				}),
			],
		});
	};

	// Render.
	return (
		<div className='data-connection-profile'>
			{profile.driverMetadata.iconSvg && (
				<img
					alt=''
					className='data-connection-profile-icon'
					src={`data:image/svg+xml;base64,${profile.driverMetadata.iconSvg}`}
				/>
			)}
			<div className='data-connection-profile-text'>
				{profile.connectionName}
				{' · '}
				{profile.driverMetadata.name}
			</div>
			<button
				ref={actionsButtonRef}
				aria-label={localize('positronDataConnections.actions', "Actions")}
				className='data-connection-profile-actions'
				onClick={showActionsMenu}
			>
				<div className='codicon codicon-ellipsis' />
			</button>
		</div>
	);
};
