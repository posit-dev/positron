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
import { showConnectDataConnectionWith } from '../dialogs/connectDataConnectionWith.js';
import { DataConnectionEntry } from '../classes/dataConnectionsTreeInstance.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { PYTHON_ICON_BASE64, R_ICON_BASE64 } from '../../../../services/positronDataConnections/common/languageIcons.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { CustomContextMenuEntry, showCustomContextMenu } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';

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

	// Extract the profile from the entry for easy access.
	const { profile } = entry;

	/**
	 * Reports a driver access error to the user.
	 */
	const reportDriverAccessError = () => {
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
	};

	/**
	 * Opens the edit dialog for this connection profile.
	 */
	const editProfile = () => {
		const driver = positronDataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			reportDriverAccessError();
			return;
		}

		// Render the ConfigureDataConnection dialog for this profile.
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

	/**
	 * Shows the actions menu for this connection entry.
	 */
	const showActionsMenu = () => {
		// Guard: if the ref isn't set, we have no anchor for the menu, so do nothing.
		if (!actionsButtonRef.current) {
			return;
		}

		// Get the driver.
		const driver = positronDataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		if (!driver) {
			reportDriverAccessError();
			return;
		}

		// Generates the connection code variants for the given language and, if any are available,
		// opens the Connect dialog to preview and run them.
		const connectWith = async (languageId: string) => {
			// The in-memory profile's parameterValues never contains secret values (those live in
			// secret storage), so this is the default, secret-free preview. Secret values are only
			// pulled in if the user explicitly opts in via the dialog's Include Secrets action.
			const variants = await driver.generateConnectionCode(languageId, profile.parameterValues);
			if (variants.length === 0) {
				notificationService.error(localize(
					'positron.dataConnections.codeGenerationFailed',
					"Could not generate connection code for '{0}'.",
					profile.connectionName
				));
				return;
			}

			showConnectDataConnectionWith({
				languageId,
				connectionName: profile.connectionName,
				driver,
				// Regenerates the code with secret values (e.g. passwords) pulled from secret storage.
				// Invoked only after the user confirms the Include Secrets action in the dialog.
				generateSecretVariants: async () => {
					const profileWithSecrets = await positronDataConnectionsService.getProfileWithSecrets(profile.id);
					if (!profileWithSecrets) {
						return [];
					}
					return driver.generateConnectionCode(languageId, profileWithSecrets.parameterValues);
				},
				variants,
			});
		};

		// Find out what languages the are supported.
		const pythonSupported = driver.metadata.supportedLanguageIds.includes('python');
		const rSupported = driver.metadata.supportedLanguageIds.includes('r');
		const sqlSupported = driver.metadata.supportedLanguageIds.includes('sql');

		// Build the menu entries.
		const entries: CustomContextMenuEntry[] = [
			new CustomContextMenuItem({
				icon: 'edit',
				label: localize('positron.dataConnections.editConnection', "Edit Connection"),
				onSelected: () => editProfile(),
			}),
		];

		// If any language is supported, add a separator before the language-specific connect options.
		if (pythonSupported || rSupported || sqlSupported) {
			// Add a separator with a label before the language-specific connect options.
			entries.push(new CustomContextMenuSeparator(localize('positron.dataConnections.connectWith', "Connect With")));

			// If Python is supported, add a "Connect with Python" entry with the Python icon.
			if (pythonSupported) {
				entries.push(new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${PYTHON_ICON_BASE64}`,
					label: localize('positron.dataConnections.connectWithPython', "Python"),
					onSelected: () => connectWith('python'),
				}));
			}

			// If R is supported, add a "Connect with R" entry with the R icon.
			if (rSupported) {
				entries.push(new CustomContextMenuItem({
					iconSrc: `data:image/svg+xml;base64,${R_ICON_BASE64}`,
					label: localize('positron.dataConnections.connectWithR', "R"),
					onSelected: () => connectWith('r'),
				}));
			}

			// If SQL is supported, add a "Connect with SQL" entry with the SQL icon.
			if (sqlSupported) {
				entries.push(new CustomContextMenuItem({
					icon: 'database',
					label: localize('positron.dataConnections.connectWithSQL', "SQL"),
					onSelected: () => connectWith('sql'),
				}));
			}
		}

		// Finally, add a separator and the remove option.
		entries.push(new CustomContextMenuSeparator());
		entries.push(
			new CustomContextMenuItem({
				destructive: true,
				icon: 'trash',
				label: localize('positron.dataConnections.remove', "Remove"),
				onSelected: () => positronDataConnectionsService.removeProfile(profile.id),
			}));

		// Show the menu.
		showCustomContextMenu({
			anchorElement: actionsButtonRef.current,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			width: 'auto',
			entries
		});
	};

	// Render.
	return (
		<div className='data-connection-entry-row'>
			<div className='codicon codicon-positron-db-database data-connection-entry-icon' />
			<div className='data-connection-entry-text'>
				{profile.connectionName}
				{' · '}
				{profile.driverMetadata.name}
			</div>
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
