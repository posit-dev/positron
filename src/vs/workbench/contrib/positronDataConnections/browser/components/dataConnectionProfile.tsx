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
import { ConfigureDataConnection } from '../dialogs/configureDataConnection.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PYTHON_ICON_BASE64, R_ICON_BASE64 } from '../../../../services/positronDataConnections/common/languageIcons.js';
import { showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';

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
	// Services.
	const { notificationService, positronDataConnectionsService } = usePositronReactServicesContext();

	// Reference hooks.
	const actionsButtonRef = useRef<HTMLButtonElement>(null);

	/**
	 * Edits the data connection profile.
	 */
	const editProfile = () => {
		// Get the driver for this profile. If it's not found, give the user a message tailored
		// to whether extensions have finished loading. Before that point, the driver is likely
		// still loading. After that point, the extension is genuinely not installed or enabled.
		const driver = positronDataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			notificationService.error(positronDataConnectionsService.driverManager.driversLoaded
				? localize(
					'positronDataConnections.driverNotInstalled',
					"Driver '{0}' is not available for connection '{1}'. The extension that provides it may not be installed or enabled.",
					profile.driverMetadata.name,
					profile.connectionName
				)
				: localize(
					'positronDataConnections.driverStillLoading',
					"Driver '{0}' is still loading for connection '{1}'. Please try again in a moment.",
					profile.driverMetadata.name,
					profile.connectionName
				)
			);

			// Don't proceed to the edit dialog if the driver isn't available.
			return;
		}

		// Create and show the configure data connection dialog for this profile.
		const renderer = new PositronModalDialogReactRenderer();
		renderer.render(
			<ConfigureDataConnection
				driver={driver}
				profile={profile}
				renderer={renderer}
				onSave={updatedProfile => {
					// Update the profile in the service.
					positronDataConnectionsService.addUpdateProfile(updatedProfile);

					// Dispose the dialog.
					renderer.dispose();
				}}
			/>
		);
	};

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
				new CustomContextMenuSeparator(localize('positronDataConnections.connectWith', "Connect With")),
				new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${PYTHON_ICON_BASE64}`,
					label: localize('positronDataConnections.connectWithPython', "Python"),
					onSelected: () => console.log(`Connect with Python: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${R_ICON_BASE64}`,
					label: localize('positronDataConnections.connectWithR', "R"),
					onSelected: () => console.log(`Connect with R: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					icon: 'database',
					label: localize('positronDataConnections.connectWithSQL', "SQL"),
					onSelected: () => console.log(`Connect with SQL: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					icon: 'edit',
					label: localize('positronDataConnections.editConnection', "Edit Connection"),
					onSelected: () => editProfile(),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					destructive: true,
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
