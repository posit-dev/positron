/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { getDataConnectionSchema, getDataConnections } from './positronDataConnectionsCommands.js';

// The Command Palette category both actions appear under.
const CATEGORY = localize2('positron.dataConnections.category', 'Data Connections');

// Both actions are gated on the data connections feature flag alone. Not on ai.enabled: they show
// the user their own connection configuration, and turning AI off shouldn't take that away. See
// isDataConnectionsCommandEnabled.
const PRECONDITION = ContextKeyExpr.equals(`config.${POSITRON_DATA_CONNECTIONS_ENABLED_KEY}`, true);

interface IDataConnectionInstancePickItem extends IQuickPickItem {
	instance: IDataConnectionInstance;
}

/**
 * Opens a payload as JSON in an untitled editor.
 * @param editorService The editor service.
 * @param payload The payload to show.
 */
async function showPayload(editorService: IEditorService, payload: unknown): Promise<void> {
	await editorService.openEditor({
		resource: undefined,
		contents: JSON.stringify(payload, null, 2),
		languageId: 'json',
		options: { pinned: true },
	} satisfies IUntitledTextResourceEditorInput);
}

/**
 * Command Palette entry that shows the positronDataConnections.getConnections payload -- the same
 * JSON Assistant reads -- in an untitled editor. Unlike the command it wraps, this ships rather than
 * being development-only, so the payload can be inspected in a release build.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ShowDataConnectionsAction extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.showConnections',
			title: localize2('positron.dataConnections.showConnections', 'Show Connections as JSON'),
			category: CATEGORY,
			f1: true,
			precondition: PRECONDITION,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// The accessor stops being valid at the first await, so the editor service is resolved up
		// front and getDataConnections is called before anything is awaited (it resolves the services
		// it needs synchronously).
		const editorService = accessor.get(IEditorService);
		const connections = await getDataConnections(accessor);

		await showPayload(editorService, connections);
	}
}

/**
 * Command Palette entry that shows the positronDataConnections.getSchema payload for a live
 * connection in an untitled editor, asking which connection to summarize when several are live.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ShowDataConnectionSchemaAction extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.showSchema',
			title: localize2('positron.dataConnections.showSchema', 'Show Schema as JSON'),
			category: CATEGORY,
			f1: true,
			precondition: PRECONDITION,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// Every service this flow needs is resolved up front: the accessor stops being valid at the
		// first await, and picking a connection is the first thing it does. That includes the
		// instantiation service, which supplies a fresh accessor for getDataConnectionSchema once the
		// picking is done.
		const instantiationService = accessor.get(IInstantiationService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

		const instances = dataConnectionsService.getInstances();
		if (instances.length === 0) {
			notificationService.info(localize(
				'positron.dataConnections.showSchema.noInstances',
				"No active data connections. Connect to one from the Data Connections panel first."
			));
			return;
		}

		const profileId = instances.length === 1
			? instances[0].profileId
			: await this._pickProfileId(quickInputService, dataConnectionsService, instances);
		if (profileId === undefined) {
			return;
		}

		// Always names a profile explicitly, even when only one connection is live, so this path and
		// a programmatic one resolve their target the same way.
		const summary = await instantiationService.invokeFunction(
			schemaAccessor => getDataConnectionSchema(schemaAccessor, { profileId }));

		await showPayload(editorService, summary);
	}

	/**
	 * Asks which of several live connections to summarize. Returns undefined if the picker is
	 * dismissed.
	 * @param quickInputService The quick input service.
	 * @param dataConnectionsService The data connections service.
	 * @param instances The live connections to choose from.
	 */
	private async _pickProfileId(
		quickInputService: IQuickInputService,
		dataConnectionsService: IPositronDataConnectionsService,
		instances: IDataConnectionInstance[],
	): Promise<string | undefined> {
		const picks: IDataConnectionInstancePickItem[] = instances.map(candidate => ({
			label: dataConnectionsService.getProfile(candidate.profileId)?.connectionName ?? candidate.profileId,
			description: candidate.driverName,
			instance: candidate,
		}));
		const pick = await quickInputService.pick(picks, {
			placeHolder: localize('positron.dataConnections.showSchema.pickInstance', "Select a data connection to summarize"),
		});

		return pick?.instance.profileId;
	}
}

registerAction2(ShowDataConnectionsAction);
registerAction2(ShowDataConnectionSchemaAction);
