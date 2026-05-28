/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionEntryRow.css';

// React.
import { useRef } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ConfigureDataConnection } from '../dialogs/configureDataConnection.js';
import { DataConnectionEntry } from '../classes/dataConnectionsTreeInstance.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PYTHON_ICON_BASE64, R_ICON_BASE64 } from '../../../../services/positronDataConnections/common/languageIcons.js';
import { showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';

/**
 * DataConnectionEntryRowProps interface.
 */
interface DataConnectionEntryRowProps {
	// The data connection entry to render.
	entry: DataConnectionEntry;
}

/**
 * DataConnectionEntryRow component. Renders a root-level entry: the saved profile plus, when
 * connected, a live-status indicator. Twistie click (handled by PositronTree) opens or closes
 * the connection; the actions menu exposes runtime-language connect options and edit/remove.
 */
export const DataConnectionEntryRow = ({ entry }: DataConnectionEntryRowProps) => {
	// Services.
	const { notificationService, positronDataConnectionsService } = usePositronReactServicesContext();

	// Reference hooks.
	const actionsButtonRef = useRef<HTMLButtonElement>(null);

	const { profile, instance } = entry;
	const connected = instance !== undefined;

	const editProfile = () => {
		const driver = positronDataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			notificationService.error(positronDataConnectionsService.driverManager.driversLoaded
				? localize(
					'positron.dataConnections.driverNotInstalled',
					"Driver '{0}' is not available for connection '{1}'. The extension that provides it may not be installed or enabled.",
					profile.driverMetadata.name,
					profile.connectionName
				)
				: localize(
					'positron.dataConnections.driverStillLoading',
					"Driver '{0}' is still loading for connection '{1}'. Please try again in a moment.",
					profile.driverMetadata.name,
					profile.connectionName
				)
			);
			return;
		}

		const renderer = new PositronModalDialogReactRenderer();
		renderer.render(
			<ConfigureDataConnection
				driver={driver}
				profile={profile}
				renderer={renderer}
				onSave={updatedProfile => {
					positronDataConnectionsService.addUpdateProfile(updatedProfile);
					renderer.dispose();
				}}
			/>
		);
	};

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
				new CustomContextMenuSeparator(localize('positron.dataConnections.connectWith', "Connect With")),
				new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${PYTHON_ICON_BASE64}`,
					label: localize('positron.dataConnections.connectWithPython', "Python"),
					onSelected: () => console.log(`Connect with Python: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${R_ICON_BASE64}`,
					label: localize('positron.dataConnections.connectWithR', "R"),
					onSelected: () => console.log(`Connect with R: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuItem({
					icon: 'database',
					label: localize('positron.dataConnections.connectWithSQL', "SQL"),
					onSelected: () => console.log(`Connect with SQL: ${profile.id} (${profile.connectionName})`),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					icon: 'edit',
					label: localize('positron.dataConnections.editConnection', "Edit Connection"),
					onSelected: () => editProfile(),
				}),
				new CustomContextMenuSeparator(),
				new CustomContextMenuItem({
					destructive: true,
					icon: 'trash',
					label: localize('positron.dataConnections.remove', "Remove"),
					onSelected: () => positronDataConnectionsService.removeProfile(profile.id),
				}),
			],
		});
	};

	return (
		<div className='data-connection-entry-row'>
			{profile.driverMetadata.iconSvg && (
				<img
					alt=''
					className='data-connection-entry-icon'
					src={`data:image/svg+xml;base64,${profile.driverMetadata.iconSvg}`}
				/>
			)}
			<div className='data-connection-entry-text'>
				{profile.connectionName}
				{' · '}
				{profile.driverMetadata.name}
			</div>
			{connected && (
				<div
					aria-label={localize('positron.dataConnections.connected', "Connected")}
					className='data-connection-entry-status'
					title={localize('positron.dataConnections.connected', "Connected")}
				/>
			)}
			<button
				ref={actionsButtonRef}
				aria-label={localize('positron.dataConnections.actions', "Actions")}
				className='data-connection-entry-actions'
				onClick={showActionsMenu}
			>
				<div className='codicon codicon-ellipsis' />
			</button>
		</div>
	);
};
