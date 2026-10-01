/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

/**
 * Whether a node can be opened in the Data Explorer: a previewable table, view, column, semantic view
 * logical table (which opens its base table), pin, or pin version. The `hasPreview` gate excludes nodes
 * the driver didn't make previewable (e.g. index-column fields, or pins whose storage type isn't
 * tabular).
 * @param dto The node.
 */
export function canPreview(dto: Pick<IDataConnectionNodeDTO, 'kind' | 'hasPreview'>): boolean {
	return dto.hasPreview && (dto.kind === 'table' || dto.kind === 'view' || dto.kind === 'field' || dto.kind === 'logical-table' || dto.kind === 'pin' || dto.kind === 'version');
}

/**
 * Opens a node in the Data Explorer, reporting a failure as a notification. The one way the pane
 * opens a node's data, whether from its row or from its details editor (by way of the tree). It
 * previews through the service rather than the handle, so the Data Explorer it opens is recorded
 * against the connection; collapsing the connection consults that record before deciding whether
 * it can be closed.
 * @param service The data connections service.
 * @param notificationService The notification service.
 * @param handle The connection the node belongs to.
 * @param dto The node.
 */
export async function openNodeInDataExplorer(
	service: IPositronDataConnectionsService,
	notificationService: INotificationService,
	handle: IDataConnectionHandle,
	dto: IDataConnectionNodeDTO
): Promise<void> {
	try {
		await service.previewNode(handle, dto.nodeHandle);
	} catch (error) {
		notificationService.error(localize(
			'positron.dataConnections.openInDataExplorerFailed',
			"Could not open '{0}' in the Data Explorer: {1}",
			dto.name,
			error instanceof Error ? error.message : String(error)
		));
	}
}
