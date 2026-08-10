/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { assertNever } from '../../../../base/common/assert.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IDataConnectionSchemaSummary } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionSchemaCommandArgs, IDataConnectionsGetConnectionsResult, getDataConnectionSchema, getDataConnections } from './positronDataConnectionsCommands.js';

// The id of the top-level data connections command. Always registered, regardless of the
// dataConnections.enabled feature flag -- see isDataConnectionsCommandEnabled for why.
export const DATA_CONNECTIONS_EXECUTE_COMMAND_ID = 'positron.dataConnections.execute';

// The sub-commands DATA_CONNECTIONS_EXECUTE_COMMAND_ID dispatches to, each named after the payload
// it produces. This list is the one place a sub-command name is spelled: the type below derives from
// it, the arg schema's enum is built from it, the picker is built from it, and validation checks
// against it. Renaming one here makes every place that has to follow suit fail to compile.
const SUB_COMMANDS = ['getDataConnections', 'getSchema'] as const;

/**
 * The name of a sub-command {@link DATA_CONNECTIONS_EXECUTE_COMMAND_ID} accepts.
 */
export type DataConnectionsSubCommand = typeof SUB_COMMANDS[number];

// The argument shape for one sub-command: its name, plus that sub-command's own options. Naming the
// sub-command through DataConnectionsSubCommand is what ties the union below to SUB_COMMANDS -- a
// name that isn't in that list is a compile error here rather than a silently unreachable member.
type ArgsFor<K extends DataConnectionsSubCommand, TOptions = unknown> = { command: K } & TOptions;

/**
 * The single argument object {@link DATA_CONNECTIONS_EXECUTE_COMMAND_ID} takes: the sub-command to
 * run, plus that sub-command's own options.
 */
export type DataConnectionsCommandArgs =
	| ArgsFor<'getDataConnections'>
	| ArgsFor<'getSchema', IDataConnectionSchemaCommandArgs>;

/**
 * What {@link DATA_CONNECTIONS_EXECUTE_COMMAND_ID} resolves to: the payload of whichever
 * sub-command ran, or undefined when that sub-command had nothing to report (see
 * {@link getDataConnectionSchema}) or the user dismissed the interactive picker.
 */
export type DataConnectionsCommandResult =
	IDataConnectionsGetConnectionsResult[] | IDataConnectionSchemaSummary | undefined;

// How each sub-command presents itself in the interactive picker. A Record over every sub-command
// name, so one added or renamed in SUB_COMMANDS doesn't compile until its picker entry follows.
const SUB_COMMAND_PICKS: Record<DataConnectionsSubCommand, { label: string; description: string }> = {
	getDataConnections: {
		label: localize('positron.dataConnections.execute.getDataConnections', "Get Data Connections"),
		description: localize('positron.dataConnections.execute.getDataConnections.description', "Every saved connection profile"),
	},
	getSchema: {
		label: localize('positron.dataConnections.execute.getSchema', "Get Schema"),
		description: localize('positron.dataConnections.execute.getSchema.description', "The schema of a live connection"),
	},
};

interface ISubCommandPickItem extends IQuickPickItem {
	command: DataConnectionsSubCommand;
}

interface IDataConnectionInstancePickItem extends IQuickPickItem {
	instance: IDataConnectionInstance;
}

function isSubCommand(value: string): value is DataConnectionsSubCommand {
	return (SUB_COMMANDS as readonly string[]).includes(value);
}

/**
 * Validates the argument object, which arrives untyped from callers across the extension host RPC
 * boundary. Throws instead of returning undefined so a caller that misspells a sub-command gets a
 * message naming the valid ones, rather than an empty payload it would read as "no connections".
 * @param value The first argument the command was invoked with.
 */
function parseCommandArgs(value: unknown): DataConnectionsCommandArgs {
	const command = typeof value === 'object' && value !== null
		? (value as { command?: unknown }).command
		: undefined;

	if (typeof command !== 'string' || !isSubCommand(command)) {
		throw new Error(
			`${DATA_CONNECTIONS_EXECUTE_COMMAND_ID}: expected an argument object with a 'command' of ` +
			`${SUB_COMMANDS.map(subCommand => `'${subCommand}'`).join(' or ')}, got ${JSON.stringify(value)}.`
		);
	}

	return value as DataConnectionsCommandArgs;
}

/**
 * Runs one sub-command. The argument object doubles as the sub-command's own options, so it is
 * passed straight through; the extra `command` property is ignored by the handler.
 * @param accessor The services accessor.
 * @param args The validated command arguments.
 */
function runSubCommand(accessor: ServicesAccessor, args: DataConnectionsCommandArgs): Promise<DataConnectionsCommandResult> {
	switch (args.command) {
		case 'getDataConnections':
			return getDataConnections(accessor);
		case 'getSchema':
			return getDataConnectionSchema(accessor, args);
		default:
			// A sub-command added to SUB_COMMANDS without a case here fails to compile, rather than
			// falling through to whichever payload happens to be last.
			return assertNever(args);
	}
}

/**
 * The top-level data connections command. Serves two callers from one registration:
 *
 * - Programmatically (notably Assistant, via executeCommand or
 *   `positron.ai.validateAndExecuteCommand`) it takes a {@link DataConnectionsCommandArgs} object
 *   and resolves to that sub-command's JSON payload.
 * - Interactively (Command Palette, no arguments) it asks which sub-command to run and opens the
 *   payload in an untitled JSON editor, so it can be inspected by hand.
 *
 * Exported so tests can construct it and call run() directly.
 */
export class DataConnectionsExecuteAction extends Action2 {
	constructor() {
		super({
			id: DATA_CONNECTIONS_EXECUTE_COMMAND_ID,
			title: localize2('positron.dataConnections.execute', 'Execute Command'),
			category: localize2('positron.dataConnections.category', 'Data Connections'),
			// f1 does more here than put the command in the palette: registerAction2 only records the
			// ICommandAction -- and with it the precondition below -- in MenuRegistry when f1 is set,
			// and that entry is the only place the agent path reads a precondition from, both to
			// filter getAgentAllowedCommands() and to gate validateAndExecute(). Without f1 the
			// command would look permanently enabled to Assistant.
			f1: true,
			precondition: ContextKeyExpr.and(
				ContextKeyExpr.equals(`config.${POSITRON_DATA_CONNECTIONS_ENABLED_KEY}`, true),
				ContextKeyExpr.equals(`config.${AI_ENABLED_KEY}`, true),
			),
			metadata: {
				description: localize(
					'positron.dataConnections.execute.description',
					"Read the user's configured data connections, or the schema of a connection that is currently live."
				),
				// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
				agentCompatible: true,
				args: [{
					name: 'args',
					description: 'The sub-command to run, plus its options.',
					schema: {
						type: 'object',
						required: ['command'],
						properties: {
							command: {
								type: 'string',
								enum: [...SUB_COMMANDS],
								description: '\'getDataConnections\' summarizes every saved connection profile, connected or not. \'getSchema\' walks the schema tree of a connection that is currently live.',
							},
							profileId: {
								type: 'string',
								description: 'getSchema only: the profile to summarize, as reported by getDataConnections. Optional when exactly one connection is live.',
							},
							maxDepth: {
								type: 'number',
								description: 'getSchema only: how many levels of the schema tree to walk.',
							},
							maxNodesPerLevel: {
								type: 'number',
								description: 'getSchema only: how many nodes to return under any one parent.',
							},
							maxTotalNodes: {
								type: 'number',
								description: 'getSchema only: how many nodes to return across the whole tree.',
							},
						},
					},
				}],
				returns: 'For \'getDataConnections\', an array of saved connection profiles: identity, driver, whether the connection is live, redacted parameter values, and the connection code per language. For \'getSchema\', a bounded tree of the connection\'s schema nodes, with truncated set when a cap left nodes out. Undefined when there was nothing to report, for example when no connection is live.',
			},
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<DataConnectionsCommandResult> {
		const [commandArgs] = args;

		// No argument means an interactive invocation (Command Palette, keybinding): ask which
		// sub-command to run rather than failing on the missing argument.
		if (commandArgs === undefined || commandArgs === null) {
			return this._runInteractively(accessor);
		}

		return runSubCommand(accessor, parseCommandArgs(commandArgs));
	}

	/**
	 * Picks a sub-command, runs it, and shows the payload. Returns the payload too, so an
	 * interactive run and a programmatic one resolve to the same thing.
	 *
	 * The accessor stops being valid at the first await, so every service this flow needs is
	 * resolved up front -- including the instantiation service, which supplies a fresh accessor for
	 * the sub-command once the picking is done.
	 * @param accessor The services accessor.
	 */
	private async _runInteractively(accessor: ServicesAccessor): Promise<DataConnectionsCommandResult> {
		const instantiationService = accessor.get(IInstantiationService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);
		const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

		const picks: ISubCommandPickItem[] = SUB_COMMANDS.map(command => ({
			...SUB_COMMAND_PICKS[command],
			command,
		}));
		const pick = await quickInputService.pick(picks, {
			placeHolder: localize('positron.dataConnections.execute.pickCommand', "Select a data connections command to run"),
		});
		if (!pick) {
			return undefined;
		}

		const args = pick.command === 'getSchema'
			? await this._pickSchemaArgs(quickInputService, notificationService, dataConnectionsService)
			: { command: 'getDataConnections' } as const;
		if (!args) {
			return undefined;
		}

		const result = await instantiationService.invokeFunction(subCommandAccessor => runSubCommand(subCommandAccessor, args));

		await editorService.openEditor({
			resource: undefined,
			contents: JSON.stringify(result, null, 2),
			languageId: 'json',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);

		return result;
	}

	/**
	 * Resolves the getSchema arguments interactively. Always names a profile explicitly, even when
	 * only one connection is live, so the interactive and programmatic paths resolve their target
	 * the same way. Returns undefined when there is nothing to summarize or the user dismissed the
	 * picker.
	 * @param quickInputService The quick input service.
	 * @param notificationService The notification service.
	 * @param dataConnectionsService The data connections service.
	 */
	private async _pickSchemaArgs(
		quickInputService: IQuickInputService,
		notificationService: INotificationService,
		dataConnectionsService: IPositronDataConnectionsService,
	): Promise<DataConnectionsCommandArgs | undefined> {
		const instances = dataConnectionsService.getInstances();
		if (instances.length === 0) {
			notificationService.info(localize(
				'positron.dataConnections.execute.noInstances',
				"No active data connections. Connect to one from the Data Connections panel first."
			));
			return undefined;
		}
		if (instances.length === 1) {
			return { command: 'getSchema', profileId: instances[0].profileId };
		}

		const picks: IDataConnectionInstancePickItem[] = instances.map(candidate => ({
			label: dataConnectionsService.getProfile(candidate.profileId)?.connectionName ?? candidate.profileId,
			description: candidate.driverName,
			instance: candidate,
		}));
		const pick = await quickInputService.pick(picks, {
			placeHolder: localize('positron.dataConnections.execute.pickInstance', "Select a data connection to summarize"),
		});

		return pick && { command: 'getSchema', profileId: pick.instance.profileId };
	}
}

registerAction2(DataConnectionsExecuteAction);
