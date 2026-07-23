/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { summarizeDataConnectionSchema } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

interface IDataConnectionInstancePickItem extends IQuickPickItem {
	instance: IDataConnectionInstance;
}

/**
 * Developer-only Command Palette entry that runs summarizeDataConnectionSchema() against a live
 * data connection instance and opens the resulting JSON in a new untitled editor. Manual testing
 * aid for the schema-summarization helper (see #14926) while no product feature calls it yet;
 * not consumed by Assistant or any other production code path.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.debugSummarizeSchema',
			title: localize2('positron.dataConnections.debugSummarizeSchema', 'Summarize Data Connection Schema (Debug)'),
			category: Categories.Developer,
			f1: true,
			precondition: IsDevelopmentContext, // hide this from release builds -- manual testing aid only
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);

		const instances = dataConnectionsService.getInstances();
		if (instances.length === 0) {
			notificationService.info(localize(
				'positron.dataConnections.debugSummarizeSchema.noInstances',
				"No active data connections. Connect to one from the Data Connections panel first."
			));
			return;
		}

		let instance: IDataConnectionInstance;
		if (instances.length === 1) {
			instance = instances[0];
		} else {
			const picks: IDataConnectionInstancePickItem[] = instances.map(candidate => ({
				label: dataConnectionsService.getProfile(candidate.profileId)?.connectionName ?? candidate.profileId,
				description: candidate.driverName,
				instance: candidate,
			}));
			const pick = await quickInputService.pick(picks, {
				placeHolder: localize('positron.dataConnections.debugSummarizeSchema.pick', "Select a data connection to summarize"),
			});
			if (!pick) {
				return;
			}
			instance = pick.instance;
		}

		const summary = await summarizeDataConnectionSchema(instance.connectionHandle);

		await editorService.openEditor({
			resource: undefined,
			contents: JSON.stringify(summary, null, 2),
			languageId: 'json',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);
	}
});
