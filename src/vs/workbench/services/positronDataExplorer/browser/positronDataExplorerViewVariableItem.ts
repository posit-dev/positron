/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IVariableItem } from '../../positronVariables/common/interfaces/variableItem.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from '../../positronDataConnections/common/positronDataConnectionsConfiguration.js';
import { IPositronDataExplorerService } from './interfaces/positronDataExplorerService.js';

/**
 * Whether the given variable item can be opened in a viewer. A connection's viewer is the older
 * Connections pane, which is not registered when the Data Connections feature replaces it.
 *
 * @param item The variable item to check.
 * @param configurationService The configuration service.
 */
export function canViewVariableItem(item: IVariableItem, configurationService: IConfigurationService): boolean {
	if (!item.hasViewer) {
		return false;
	}
	return item.kind !== 'connection' ||
		configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === false;
}

/**
 * Opens a Data Explorer viewer for the given variable item, or activates the
 * existing viewer if one is already open.
 *
 * @param sessionId The session that owns the variable.
 * @param item The variable item to view.
 * @param dataExplorerService The data explorer service.
 * @param notificationService The notification service, used to surface errors.
 */
export const viewVariableItem = async (
	sessionId: string,
	item: IVariableItem,
	dataExplorerService: IPositronDataExplorerService,
	notificationService: INotificationService,
): Promise<void> => {
	// Check for an existing viewer instance by variable ID.
	const instance = dataExplorerService.getInstanceForVar(item.id);
	if (instance) {
		instance.requestFocus();
		return;
	}

	// Check for an existing viewer by canonical variable path. This catches
	// instances opened from inline notebook data explorers.
	if (item.path.length > 0) {
		const pathInstance = dataExplorerService.getInstanceForVariablePath(sessionId, item.path);
		if (pathInstance) {
			pathInstance.requestFocus();
			return;
		}
	}

	// Open a viewer for the variable item.
	let viewerId: string | undefined;
	try {
		viewerId = await item.view();
	} catch (err) {
		notificationService.error(localize(
			'positron.variables.viewerError',
			"An error occurred while opening the viewer. Try restarting your session."
		));
		return;
	}

	// If a binding was returned, save the binding between the viewer and the
	// variable item. It's valid for backends to not return any ID if no comm
	// was open (e.g., Ark opens a virtual document for function objects, which
	// is not managed by a comm).
	if (viewerId) {
		dataExplorerService.setInstanceForVar(viewerId, item.id);
	}
};
