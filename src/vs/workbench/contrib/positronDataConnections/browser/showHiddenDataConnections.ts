/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

// Kept out of positronDataConnectionsInspectActions.ts, which registers actions when it loads, so
// the Data Connections pane can show hidden connections without loading that module.

interface IHiddenDataConnectionPickItem extends IQuickPickItem {
	profileId: string;
}

/**
 * Offers the hidden detected connections and shows the ones the user picks again. Says so when
 * nothing is hidden.
 * @param dataConnectionsService The data connections service.
 * @param quickInputService The quick input service.
 * @param notificationService The notification service.
 */
export async function showHiddenDataConnections(
	dataConnectionsService: IPositronDataConnectionsService,
	quickInputService: IQuickInputService,
	notificationService: INotificationService,
): Promise<void> {
	const hidden = dataConnectionsService.getHiddenDiscoveredProfiles();
	if (hidden.length === 0) {
		notificationService.info(localize('positron.dataConnections.showHiddenConnections.none', "No data connections are hidden."));
		return;
	}

	const picks = await quickInputService.pick<IHiddenDataConnectionPickItem>(
		hidden.map(profile => ({
			label: profile.connectionName,
			description: profile.driverMetadata.name,
			detail: profile.description,
			profileId: profile.id,
		})),
		{
			canPickMany: true,
			placeHolder: localize('positron.dataConnections.showHiddenConnections.pick', "Select the connections to show again"),
		});
	if (!picks || picks.length === 0) {
		return;
	}

	dataConnectionsService.unhideDiscoveredProfiles(picks.map(pick => pick.profileId));
}
