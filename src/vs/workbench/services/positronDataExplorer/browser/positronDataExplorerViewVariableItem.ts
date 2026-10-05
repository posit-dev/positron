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
import { IPositronObjectExplorerService } from '../../positronObjectExplorer/browser/interfaces/positronObjectExplorerService.js';

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
		configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) !== true;
}

/**
 * The registry of open viewers kept by the Data Explorer and Object Explorer services.
 */
interface IVariableViewerRegistry {
	getInstanceForVar(variableId: string): { requestFocus(): void } | undefined;
	getInstanceForVariablePath(sessionId: string, variablePath: string[]): { requestFocus(): void } | undefined;
	setInstanceForVar(instanceId: string, variableId: string): void;
}

/**
 * Opens a viewer for the given variable item, or activates the existing viewer if one is already
 * open. The backend decides which viewer opens, so both explorers' registries are consulted.
 *
 * @param sessionId The session that owns the variable.
 * @param item The variable item to view.
 * @param dataExplorerService The data explorer service.
 * @param objectExplorerService The object explorer service.
 * @param notificationService The notification service, used to surface errors.
 */
export const viewVariableItem = async (
	sessionId: string,
	item: IVariableItem,
	dataExplorerService: IPositronDataExplorerService,
	objectExplorerService: IPositronObjectExplorerService,
	notificationService: INotificationService,
): Promise<void> => {
	const registries: IVariableViewerRegistry[] = [dataExplorerService, objectExplorerService];

	// Check for an existing viewer by variable ID, then by canonical variable path. The latter
	// catches viewers opened from inline notebook outputs.
	for (const registry of registries) {
		const instance = registry.getInstanceForVar(item.id) ??
			(item.path.length > 0 ? registry.getInstanceForVariablePath(sessionId, item.path) : undefined);
		if (instance) {
			instance.requestFocus();
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
	// is not managed by a comm). The viewer may not be registered yet, so both
	// registries record the binding; only the one that owns the viewer resolves it.
	if (viewerId) {
		for (const registry of registries) {
			registry.setInstanceForVar(viewerId, item.id);
		}
	}
};
