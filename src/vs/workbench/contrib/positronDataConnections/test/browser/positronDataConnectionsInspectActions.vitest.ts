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
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IDataConnectionDriver, IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { GET_CONNECTIONS_COMMAND_ID, GET_CONNECTION_CODE_COMMAND_ID, GET_SCHEMA_COMMAND_ID } from '../../browser/positronDataConnectionsCommands.js';
import { ShowDataConnectionCodeAction, ShowDataConnectionSchemaAction, ShowDataConnectionsAction } from '../../browser/positronDataConnectionsInspectActions.js';

// The field the picker's items carry, as much of it as answering the picker needs.
interface IPickAnswer {
	profileId: string;
}

// A saved profile, named after its id so a test can tell which one the picker answered with.
function createProfile(id: string): IDataConnectionProfile {
	return {
		id,
		connectionName: `${id}-name`,
		driverMetadata: { id: 'test-driver', name: 'Test Driver', iconSvg: '', supportedLanguageIds: ['r'] },
		mechanismId: 'test-mechanism',
		parameterValues: {},
	};
}

// The driver behind every profile in these tests: one r variant whose code names the profile it came
// from, so a test can tell whose code was shown.
function createDriver(): IDataConnectionDriver {
	return stubInterface<IDataConnectionDriver>({
		id: 'test-driver',
		metadata: {
			id: 'test-driver',
			name: 'Test Driver',
			description: '',
			iconSvg: '',
			supportedLanguageIds: ['r'],
			mechanisms: [{ id: 'test-mechanism', label: 'Test Mechanism', description: '', parameters: [] }],
		},
		generateConnectionCode: vi.fn(async () => [{ id: 'dbi', label: 'DBI', code: 'con <- connect()\n' }]),
	});
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

	// Wires the services run() reads. `instances` is what the connections service reports as live, and
	// `profiles` what it reports as configured -- independent, since a profile needs no live
	// connection and the code action reads only the profiles.
	function stubServices(instances: IDataConnectionInstance[], profiles: IDataConnectionProfile[] = []): void {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': true,
		}));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		const driver = createDriver();
		ctx.instantiationService.stub(IPositronDataConnectionsService, stubInterface<IPositronDataConnectionsService>({
			// These tests configure no discovered connections, so the catalog is the profiles as-is.
			getAllProfiles: vi.fn(() => profiles),
			driverManager: stubInterface<IDataConnectionsDriverManager>({
				getDriver: vi.fn((driverId: string) => driverId === driver.id ? driver : undefined),
			}),
			// The catalog payload redacts parameters through the service; these profiles have no
			// parameters at all, so there is nothing to redact.
			getDisplayParameterValues: vi.fn(async () => ({})),
			getInstances: vi.fn(() => instances),
			getInstanceForProfile: vi.fn((profileId: string) =>
				instances.find(instance => instance.profileId === profileId)),
			// The schema tests pass no profiles, so the instance picker's getProfile lookup finds
			// nothing there and labels each connection by its profile id.
			getProfile: vi.fn((profileId: string) => profiles.find(profile => profile.id === profileId)),
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

	function run(action: ShowDataConnectionsAction | ShowDataConnectionCodeAction | ShowDataConnectionSchemaAction) {
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

	it('shows the only configured connection\'s code as JSON, without asking which to show', async () => {
		stubServices([], [createProfile('conn-a')]);

		await run(new ShowDataConnectionCodeAction());

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(
				{ profileId: 'conn-a', languages: { r: { code: 'con <- connect()\n', variableName: 'con' } } },
				null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
		expect(pick).not.toHaveBeenCalled();
	});

	// The code is generated from the saved profile, so nothing needs to be connected for this to work
	// -- which is the whole point of the command it wraps.
	it('shows the code for the connection chosen from the picker, with nothing live', async () => {
		stubServices([], [createProfile('conn-a'), createProfile('conn-b')]);
		pick.mockImplementation(async items => items.find(item => item.profileId === 'conn-b'));

		await run(new ShowDataConnectionCodeAction());

		expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
			contents: expect.stringContaining('conn-b'),
		}));
	});

	it('opens nothing when the connection code picker is dismissed', async () => {
		stubServices([], [createProfile('conn-a'), createProfile('conn-b')]);
		pick.mockResolvedValue(undefined);

		await run(new ShowDataConnectionCodeAction());

		expect(openEditor).not.toHaveBeenCalled();
	});

	// A `not-found` payload would be a confusing thing to open here: the command reports it for an id
	// that doesn't exist, and the real problem is that the user has configured nothing at all.
	it('says how to configure a connection, rather than opening a not-found payload', async () => {
		stubServices([], []);

		await run(new ShowDataConnectionCodeAction());

		expect(info).toHaveBeenCalledWith('No data connections are configured. Add one from the Data Connections panel first.');
		expect(openEditor).not.toHaveBeenCalled();
	});

	it('shows the only live connection\'s schema as JSON, without asking which to summarize', async () => {
		await run(new ShowDataConnectionSchemaAction());

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(
				{ instanceId: '1', lines: ['conn-a-table [table]'], truncated: false },
				null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
		expect(pick).not.toHaveBeenCalled();
	});

	it('summarizes the connection chosen from the picker when several are live', async () => {
		stubServices([createInstance('conn-a', 1), createInstance('conn-b', 2)]);
		pick.mockImplementation(async items => items.find(item => item.profileId === 'conn-b'));

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

	// The action promises never to open a connection of its own, but the picker is awaited, so the
	// chosen connection can close before the answer lands -- and getSchema would then silently
	// reconnect it. The service stub has no connect() at all (stubInterface throws on unset reads),
	// so this test fails loudly if the action ever lets getSchema's auto-connect fire.
	it('does not reconnect a connection that closed while the picker was open', async () => {
		const instances = [createInstance('conn-a', 1), createInstance('conn-b', 2)];
		stubServices(instances);
		pick.mockImplementation(async items => {
			// The chosen connection closes while the picker is open.
			instances.splice(1, 1);
			return items.find(item => item.profileId === 'conn-b');
		});

		await run(new ShowDataConnectionSchemaAction());

		expect(info).toHaveBeenCalledWith('The selected data connection is no longer active. Connect to it from the Data Connections panel first.');
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
			expected: { instanceId: '1', lines: ['conn-a-table [table]'], truncated: false },
		},
		{
			id: GET_SCHEMA_COMMAND_ID,
			args: { profileId: 'conn-missing' },
			expected: { connected: false, reason: 'not-found' },
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
	it('keeps every palette entry gated on the feature flag', () => {
		const descriptors = [new ShowDataConnectionsAction(), new ShowDataConnectionCodeAction(), new ShowDataConnectionSchemaAction()]
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
			    "id": "positronDataConnections.showConnectionCode",
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
	it('advertises every payload command to the agent path', () => {
		const descriptors = [GET_CONNECTIONS_COMMAND_ID, GET_CONNECTION_CODE_COMMAND_ID, GET_SCHEMA_COMMAND_ID].map(id => {
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
			      undefined,
			    ],
			    "id": "positronDataConnections.getConnectionCode",
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
