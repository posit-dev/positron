/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { GET_CONNECTIONS_COMMAND_ID, GET_SCHEMA_COMMAND_ID } from '../../browser/positronDataConnectionsCommands.js';
import { ShowDataConnectionSchemaAction, ShowDataConnectionsAction } from '../../browser/positronDataConnectionsInspectActions.js';

// The field the instance picker's items carry, as much of it as answering the picker needs.
interface IPickAnswer {
	instance: IDataConnectionInstance;
}

// A live connection whose schema is a single table, named after the profile so a test can tell
// which connection was summarized.
function createInstance(profileId: string, handle: number): IDataConnectionInstance {
	return stubInterface<IDataConnectionInstance>({
		profileId,
		driverName: 'Test Driver',
		connectionHandle: stubInterface<IDataConnectionHandle>({
			handle,
			getChildren: vi.fn(async () => [{
				nodeHandle: 1,
				name: `${profileId}-table`,
				kind: 'table',
				hasGetChildren: false,
				hasPreview: false,
			}]),
		}),
	});
}

describe('data connections inspect actions', () => {
	const ctx = createTestContainer().build();

	let pick: ReturnType<typeof vi.fn<(items: readonly IPickAnswer[]) => Promise<IPickAnswer | undefined>>>;
	let openEditor: ReturnType<typeof vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>>;
	let info: ReturnType<typeof vi.fn<INotificationService['info']>>;

	// Wires the services run() reads. `instances` is what the connections service reports as live.
	function stubServices(instances: IDataConnectionInstance[]): void {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': true,
		}));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronDataConnectionsService, stubInterface<IPositronDataConnectionsService>({
			// No profile is configured, so the connections payload is an empty list.
			getProfiles: vi.fn(() => []),
			getInstances: vi.fn(() => instances),
			getInstanceForProfile: vi.fn((profileId: string) =>
				instances.find(instance => instance.profileId === profileId)),
			// No stored profile, so the instance picker labels each connection by its profile id.
			getProfile: vi.fn(() => undefined),
		}));
		// pick and openEditor are generic over their argument types; the casts tell the compiler what
		// these mocks already are, the way notebookCommandsQuickPick.vitest.ts stubs createQuickPick.
		ctx.instantiationService.stub(IQuickInputService, stubInterface<IQuickInputService>({
			pick: pick as unknown as IQuickInputService['pick'],
		}));
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({
			openEditor: openEditor as unknown as IEditorService['openEditor'],
		}));
		ctx.instantiationService.stub(INotificationService, stubInterface<INotificationService>({ info }));
	}

	beforeEach(() => {
		pick = vi.fn<(items: readonly IPickAnswer[]) => Promise<IPickAnswer | undefined>>();
		openEditor = vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>();
		info = vi.fn<INotificationService['info']>();
		stubServices([createInstance('conn-a', 1)]);
	});

	function run(action: ShowDataConnectionsAction | ShowDataConnectionSchemaAction) {
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
	}

	// The JSON contents are the whole point of these actions: they're what a developer reads to see
	// exactly what Assistant gets from the command each one wraps.
	it('shows the connections payload as JSON', async () => {
		await run(new ShowDataConnectionsAction());

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: '[]',
			languageId: 'json',
			options: { pinned: true },
		});
	});

	it('shows the only live connection\'s schema as JSON, without asking which to summarize', async () => {
		await run(new ShowDataConnectionSchemaAction());

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(
				{ instanceId: '1', nodes: [{ name: 'conn-a-table', kind: 'table' }], truncated: false },
				null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
		expect(pick).not.toHaveBeenCalled();
	});

	it('summarizes the connection chosen from the picker when several are live', async () => {
		stubServices([createInstance('conn-a', 1), createInstance('conn-b', 2)]);
		pick.mockImplementation(async items => items.find(item => item.instance.profileId === 'conn-b'));

		await run(new ShowDataConnectionSchemaAction());

		expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
			contents: expect.stringContaining('conn-b-table'),
		}));
	});

	it('opens nothing when the connection picker is dismissed', async () => {
		stubServices([createInstance('conn-a', 1), createInstance('conn-b', 2)]);
		pick.mockResolvedValue(undefined);

		await run(new ShowDataConnectionSchemaAction());

		expect(openEditor).not.toHaveBeenCalled();
	});

	it('says how to connect, rather than opening an empty summary, when no connection is live', async () => {
		stubServices([]);

		await run(new ShowDataConnectionSchemaAction());

		expect(info).toHaveBeenCalledWith('No active data connections. Connect to one from the Data Connections panel first.');
		expect(openEditor).not.toHaveBeenCalled();
	});

	// The property Assistant depends on: executing a payload command hands the JSON back to the
	// caller and leaves the workbench alone. Opening an editor is what the two actions above are for,
	// and wiring one into a payload command's handler by mistake would put a file in the user's face
	// every time Assistant asked what connections exist.
	it.each([
		{
			id: GET_CONNECTIONS_COMMAND_ID,
			args: undefined,
			expected: [],
		},
		{
			id: GET_SCHEMA_COMMAND_ID,
			args: { profileId: 'conn-a' },
			expected: { instanceId: '1', nodes: [{ name: 'conn-a-table', kind: 'table' }], truncated: false },
		},
		{
			id: GET_SCHEMA_COMMAND_ID,
			args: { profileId: 'conn-missing' },
			expected: { connected: false, reason: 'not-connected' },
		},
	])('$id returns its payload to a programmatic caller without opening an editor', async ({ id, args, expected }) => {
		// The registry types every handler as returning void; these two return their payload, which is
		// what executeCommand passes back to the caller.
		const handler = CommandsRegistry.getCommand(id)?.handler as
			((accessor: ServicesAccessor, args?: unknown) => Promise<unknown>) | undefined;

		const result = await ctx.instantiationService.invokeFunction(accessor => handler!(accessor, args));

		expect(result).toEqual(expected);
		expect(openEditor).not.toHaveBeenCalled();
	});

	// Both actions are Command Palette entries gated on the feature flag, and neither is
	// agentCompatible -- an agent wants the payload commands, which return the payload instead of
	// opening an editor.
	it('keeps both palette entries gated on the feature flag', () => {
		const descriptors = [new ShowDataConnectionsAction(), new ShowDataConnectionSchemaAction()]
			.map(({ desc }) => ({
				id: desc.id,
				f1: desc.f1,
				precondition: desc.precondition?.serialize(),
				agentCompatible: desc.metadata?.agentCompatible,
			}));

		expect(descriptors).toMatchInlineSnapshot(`
			[
			  {
			    "agentCompatible": undefined,
			    "f1": true,
			    "id": "positronDataConnections.showConnections",
			    "precondition": "config.dataConnections.enabled",
			  },
			  {
			    "agentCompatible": undefined,
			    "f1": true,
			    "id": "positronDataConnections.showSchema",
			    "precondition": "config.dataConnections.enabled",
			  },
			]
		`);
	});
});

// Importing the commands module registers both payload commands. Nothing else in the build fails if
// agentCompatible is dropped, or if the argument object stops being marked optional -- the agent path
// would just stop advertising the command, or start telling the model an argument is required.
describe('data connections payload commands', () => {
	it('advertises both payload commands to the agent path', () => {
		const descriptors = [GET_CONNECTIONS_COMMAND_ID, GET_SCHEMA_COMMAND_ID].map(id => {
			const metadata = CommandsRegistry.getCommand(id)?.metadata;
			return {
				id,
				agentCompatible: metadata?.agentCompatible,
				argsOptional: metadata?.args?.map(arg => arg.isOptional),
			};
		});

		expect(descriptors).toMatchInlineSnapshot(`
			[
			  {
			    "agentCompatible": true,
			    "argsOptional": undefined,
			    "id": "positronDataConnections.getConnections",
			  },
			  {
			    "agentCompatible": true,
			    "argsOptional": [
			      true,
			    ],
			    "id": "positronDataConnections.getSchema",
			  },
			]
		`);
	});
});
