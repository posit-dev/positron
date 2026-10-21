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
import { getDataConnectionCode, getDataConnectionLineage, getDataConnectionSchema, getDataConnections } from './positronDataConnectionsCommands.js';

// The Command Palette category these actions appear under.
const CATEGORY = localize2('positron.dataConnections.category', 'Data Connections');

// Every action is gated on the data connections feature flag alone. Not on ai.enabled: they show
// the user their own connection configuration, and turning AI off shouldn't take that away. See
// isDataConnectionsCommandEnabled.
const PRECONDITION = ContextKeyExpr.equals(`config.${POSITRON_DATA_CONNECTIONS_ENABLED_KEY}`, true);

interface IDataConnectionProfilePickItem extends IQuickPickItem {
	profileId: string;
}

/**
 * Asks which of several connections to inspect. Returns undefined if the picker is dismissed. Both
 * actions that need to choose pick the same way -- only what they are choosing among differs, which
 * is what the caller builds into `picks`.
 * @param quickInputService The quick input service.
 * @param picks The connections to choose from.
 * @param placeHolder The picker's placeholder text.
 */
async function pickProfileId(
	quickInputService: IQuickInputService,
	picks: IDataConnectionProfilePickItem[],
	placeHolder: string,
): Promise<string | undefined> {
	const pick = await quickInputService.pick(picks, { placeHolder });

	return pick?.profileId;
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
 * Command Palette entry that shows the positronDataConnections.getConnectionCode payload -- the
 * code that opens a connection -- in an untitled editor, asking which connection when the user has
 * several configured. Unlike the catalog action above this needs no live connection: the code is
 * generated from the saved or discovered profile.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ShowDataConnectionCodeAction extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.showConnectionCode',
			title: localize2('positron.dataConnections.showConnectionCode', 'Show Connection Code as JSON'),
			category: CATEGORY,
			f1: true,
			precondition: PRECONDITION,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// Every service this flow needs is resolved up front: the accessor stops being valid at the
		// first await, and picking a connection is the first thing it does. That includes the
		// instantiation service, which supplies a fresh accessor for getDataConnectionCode once the
		// picking is done.
		const instantiationService = accessor.get(IInstantiationService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

		// The same catalog getConnections reports (saved profiles plus discovered connections), so
		// the picker offers exactly the ids the getConnectionCode command accepts.
		const profiles = dataConnectionsService.getAllProfiles();
		if (profiles.length === 0) {
			notificationService.info(localize(
				'positron.dataConnections.showConnectionCode.noProfiles',
				"No data connections are configured. Add one from the Data Connections panel first."
			));
			return;
		}

		const profileId = profiles.length === 1
			? profiles[0].id
			: await pickProfileId(
				quickInputService,
				profiles.map(profile => ({
					label: profile.connectionName,
					description: profile.driverMetadata.name,
					profileId: profile.id,
				})),
				localize('positron.dataConnections.showConnectionCode.pickProfile', "Select a data connection to show the connection code for"));
		if (profileId === undefined) {
			return;
		}

		// No languageId: this shows what the command can produce, and every language the driver
		// supports is the superset of what an agent could ask for.
		const code = await instantiationService.invokeFunction(
			codeAccessor => getDataConnectionCode(codeAccessor, { profileId }));

		await showPayload(editorService, code);
	}
}

/**
 * Command Palette entry that shows the positronDataConnections.getSchema payload for a live
 * connection in an untitled editor, asking which connection to summarize when several are live.
 * Only live connections are offered, so unlike the command it wraps -- which connects its target
 * automatically when it isn't live -- this action never opens a connection of its own.
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

		const profileId = await pickLiveProfileId(
			dataConnectionsService,
			quickInputService,
			notificationService,
			localize('positron.dataConnections.showSchema.pickInstance', "Select a data connection to summarize"));
		if (profileId === undefined) {
			return;
		}

		// The pick was awaited, so the chosen connection may have closed in the meantime -- and
		// getSchema would then silently reconnect it (see its auto-connect), which this action
		// promises never to do. Re-checking here, with no await before the getSchema call below,
		// keeps the promise: getSchema finds the same live instance this check did.
		if (dataConnectionsService.getInstanceForProfile(profileId) === undefined) {
			notificationService.info(localize(
				'positron.dataConnections.showSchema.instanceClosed',
				"The selected data connection is no longer active. Connect to it from the Data Connections panel first."
			));
			return;
		}

		// Always names a profile explicitly, even when only one connection is live, so this path and
		// a programmatic one resolve their target the same way.
		const summary = await instantiationService.invokeFunction(
			schemaAccessor => getDataConnectionSchema(schemaAccessor, { profileId }));

		await showPayload(editorService, summary);
	}
}

/**
 * Chooses a live connection for the actions that only offer live ones: the only one when exactly
 * one is live, otherwise the one picked from them, labelled by profile name (falling back to the
 * profile id when the profile it came from is gone). Returns undefined -- after saying how to
 * connect -- when nothing is live, and undefined when the picker is dismissed.
 * @param dataConnectionsService The data connections service.
 * @param quickInputService The quick input service.
 * @param notificationService The notification service.
 * @param placeHolder The picker's placeholder text.
 */
async function pickLiveProfileId(
	dataConnectionsService: IPositronDataConnectionsService,
	quickInputService: IQuickInputService,
	notificationService: INotificationService,
	placeHolder: string,
): Promise<string | undefined> {
	const instances: IDataConnectionInstance[] = dataConnectionsService.getInstances();
	if (instances.length === 0) {
		notificationService.info(localize(
			'positron.dataConnections.showSchema.noInstances',
			"No active data connections. Connect to one from the Data Connections panel first."
		));
		return undefined;
	}
	if (instances.length === 1) {
		return instances[0].profileId;
	}
	return pickProfileId(
		quickInputService,
		instances.map(candidate => ({
			label: dataConnectionsService.getProfile(candidate.profileId)?.connectionName ?? candidate.profileId,
			description: candidate.driverName,
			profileId: candidate.profileId,
		})),
		placeHolder);
}

interface IChoicePickItem<T extends string> extends IQuickPickItem {
	value: T;
}

/**
 * Command Palette entry that shows the positronDataConnections.getLineage payload for an object in
 * a live connection in an untitled editor. Asks which connection (when several are live), the
 * object's name, the direction to follow, and whether the name is a table's or a column's. Like
 * Show Schema, only live connections are offered, and this action never opens a connection of its
 * own.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class ShowDataConnectionLineageAction extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.showLineage',
			title: localize2('positron.dataConnections.showLineage', 'Show Lineage as JSON'),
			category: CATEGORY,
			f1: true,
			precondition: PRECONDITION,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		// Every service this flow needs is resolved up front: the accessor stops being valid at the
		// first await. See ShowDataConnectionSchemaAction.
		const instantiationService = accessor.get(IInstantiationService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

		const profileId = await pickLiveProfileId(
			dataConnectionsService,
			quickInputService,
			notificationService,
			localize('positron.dataConnections.showLineage.pickInstance', "Select a data connection to read lineage from"));
		if (profileId === undefined) {
			return;
		}

		const objectName = await quickInputService.input({
			prompt: localize('positron.dataConnections.showLineage.objectName', "The fully qualified name of a table, view or column"),
			placeHolder: localize('positron.dataConnections.showLineage.objectNamePlaceholder', "database.schema.table or database.schema.table.column"),
		});
		if (!objectName?.trim()) {
			return;
		}

		const direction = await quickInputService.pick<IChoicePickItem<'upstream' | 'downstream'>>([
			{
				label: localize('positron.dataConnections.showLineage.upstream', "Upstream"),
				description: localize('positron.dataConnections.showLineage.upstreamDescription', "Where the data comes from"),
				value: 'upstream',
			},
			{
				label: localize('positron.dataConnections.showLineage.downstream', "Downstream"),
				description: localize('positron.dataConnections.showLineage.downstreamDescription', "What is built from it"),
				value: 'downstream',
			},
		], { placeHolder: localize('positron.dataConnections.showLineage.pickDirection', "Select the direction to follow") });
		if (!direction) {
			return;
		}

		const domain = await quickInputService.pick<IChoicePickItem<'table' | 'column'>>([
			{ label: localize('positron.dataConnections.showLineage.table', "Table or View"), value: 'table' },
			{ label: localize('positron.dataConnections.showLineage.column', "Column"), value: 'column' },
		], { placeHolder: localize('positron.dataConnections.showLineage.pickDomain', "Select what the name refers to") });
		if (!domain) {
			return;
		}

		// The prompts were awaited, so the chosen connection may have closed in the meantime -- and
		// getLineage would then silently reconnect it. Re-checking here, with no await before the
		// getLineage call below, keeps this action from ever opening a connection.
		if (dataConnectionsService.getInstanceForProfile(profileId) === undefined) {
			notificationService.info(localize(
				'positron.dataConnections.showLineage.instanceClosed',
				"The selected data connection is no longer active. Connect to it from the Data Connections panel first."
			));
			return;
		}

		const lineage = await instantiationService.invokeFunction(
			lineageAccessor => getDataConnectionLineage(lineageAccessor, {
				profileId,
				objectName,
				direction: direction.value,
				domain: domain.value,
			}));

		await showPayload(editorService, lineage);
	}
}

registerAction2(ShowDataConnectionsAction);
registerAction2(ShowDataConnectionCodeAction);
registerAction2(ShowDataConnectionSchemaAction);
registerAction2(ShowDataConnectionLineageAction);
