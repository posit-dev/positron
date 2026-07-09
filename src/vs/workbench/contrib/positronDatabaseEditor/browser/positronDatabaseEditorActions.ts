/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { PositronDatabaseEditorInput, databaseConnectionProfile } from './positronDatabaseEditorInput.js';

/**
 * The id of the Data Connections view (panel), revealed after creating a data connection.
 */
const POSITRON_DATA_CONNECTIONS_VIEW_ID = 'workbench.panel.positronDataConnections';

/**
 * True when a Positron database editor is the active editor.
 */
const POSITRON_DATABASE_EDITOR_IS_ACTIVE_EDITOR = ContextKeyExpr.equals(
	'activeEditor',
	PositronDatabaseEditorInput.EditorID
);

/**
 * CreateDataConnectionAction. Editor-title-bar action that saves the open database file as a
 * persistent data connection and reveals it in the Data Connections view.
 */
class CreateDataConnectionAction extends Action2 {
	static readonly ID = 'positron.databaseEditor.createDataConnection';

	constructor() {
		super({
			id: CreateDataConnectionAction.ID,
			title: localize2('positron.databaseEditor.createDataConnection', "Create Data Connection"),
			icon: Codicon.positronDataConnections,
			f1: false,
			precondition: POSITRON_DATABASE_EDITOR_IS_ACTIVE_EDITOR,
			// Render as an icon + text button in the Positron editor action bar.
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: true
			},
			menu: [
				{
					id: MenuId.EditorActionsRight,
					group: 'navigation',
					order: 1,
					when: POSITRON_DATABASE_EDITOR_IS_ACTIVE_EDITOR,
				}
			]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);
		const notificationService = accessor.get(INotificationService);
		const viewsService = accessor.get(IViewsService);

		const input = editorService.activeEditor;
		if (!(input instanceof PositronDatabaseEditorInput)) {
			return;
		}

		const driver = dataConnectionsService.driverManager.getDriver(input.driverId);
		if (!driver) {
			notificationService.error(localize(
				'positron.databaseEditor.createDataConnectionFailed',
				"The data connection driver '{0}' is not available.",
				input.driverId
			));
			return;
		}

		// Save a persistent connection (distinct from the editor's ephemeral one) for this file.
		dataConnectionsService.addUpdateProfile(databaseConnectionProfile(generateUuid(), driver, input.resource));

		// Reveal the Data Connections view so the new connection is visible.
		await viewsService.openView(POSITRON_DATA_CONNECTIONS_VIEW_ID, true);
	}
}

/**
 * Registers the Positron database editor actions.
 */
export function registerPositronDatabaseEditorActions(): void {
	registerAction2(CreateDataConnectionAction);
}
