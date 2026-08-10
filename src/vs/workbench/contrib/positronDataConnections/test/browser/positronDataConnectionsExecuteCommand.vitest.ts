/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionsExecuteAction, DataConnectionsSubCommand } from '../../browser/positronDataConnectionsExecuteCommand.js';

// The fields the two pickers' items carry, as much of them as answering a picker needs: the
// sub-command picker's items have a `command`, the instance picker's an `instance`.
interface IPickAnswer {
	command?: string;
	instance?: IDataConnectionInstance;
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

describe('DataConnectionsExecuteAction', () => {
	const ctx = createTestContainer().build();

	let getProfiles: ReturnType<typeof vi.fn<IPositronDataConnectionsService['getProfiles']>>;
	let pick: ReturnType<typeof vi.fn<(items: readonly IPickAnswer[]) => Promise<IPickAnswer | undefined>>>;
	let openEditor: ReturnType<typeof vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>>;
	let info: ReturnType<typeof vi.fn<INotificationService['info']>>;

	// Wires the services run() reads. `instances` is what the connections service reports as live.
	function stubServices(instances: IDataConnectionInstance[]): void {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': true,
			'ai.enabled': true,
		}));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronDataConnectionsService, stubInterface<IPositronDataConnectionsService>({
			getProfiles,
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

	/**
	 * Answers the interactive pickers: the sub-command picker with `command`, and the instance
	 * picker (when several connections are live) with the one for `profileId`. Items carrying an
	 * `instance` belong to the second picker, which is what tells the two apart.
	 */
	function answerPickers(command: DataConnectionsSubCommand, profileId?: string): void {
		pick.mockImplementation(async items => items.find(item => item.instance
			? item.instance.profileId === profileId
			: item.command === command));
	}

	beforeEach(() => {
		getProfiles = vi.fn<IPositronDataConnectionsService['getProfiles']>().mockReturnValue([]);
		pick = vi.fn<(items: readonly IPickAnswer[]) => Promise<IPickAnswer | undefined>>();
		openEditor = vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>();
		info = vi.fn<INotificationService['info']>();
		stubServices([createInstance('conn-a', 1)]);
	});

	function run(...args: unknown[]) {
		const action = new DataConnectionsExecuteAction();
		return ctx.instantiationService.invokeFunction(accessor => action.run(accessor, ...args));
	}

	it('routes getDataConnections to the connections payload', async () => {
		const result = await run({ command: 'getDataConnections' });

		// No profiles are configured, so the payload is empty -- the call itself is the evidence of
		// where the argument was routed.
		expect(getProfiles).toHaveBeenCalled();
		expect(result).toEqual([]);
	});

	it('routes getSchema to the schema payload, passing its options along', async () => {
		const result = await run({ command: 'getSchema', profileId: 'conn-a', maxDepth: 1 });

		expect(result).toEqual({ instanceId: '1', nodes: [{ name: 'conn-a-table', kind: 'table' }], truncated: false });
		expect(getProfiles).not.toHaveBeenCalled();
	});

	it('throws a message naming the valid sub-commands when given an unknown one', async () => {
		await expect(run({ command: 'getSchemas' })).rejects.toThrowError(
			/expected an argument object with a 'command' of 'getDataConnections' or 'getSchema'/
		);
	});

	// A caller that passes the sub-command as a bare string rather than in an object gets the same
	// message, instead of an empty payload it would read as "no connections configured".
	it('throws when the argument is not an object', async () => {
		await expect(run('getSchema')).rejects.toThrowError(/expected an argument object/);
	});

	it('picks a sub-command and opens its payload as JSON when invoked with no arguments', async () => {
		answerPickers('getSchema');

		const result = await run();

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(result, null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
		expect(result).toEqual({ instanceId: '1', nodes: [{ name: 'conn-a-table', kind: 'table' }], truncated: false });
	});

	it('summarizes the connection chosen from the instance picker when several are live', async () => {
		stubServices([createInstance('conn-a', 1), createInstance('conn-b', 2)]);
		answerPickers('getSchema', 'conn-b');

		const result = await run();

		expect(result).toEqual({ instanceId: '2', nodes: [{ name: 'conn-b-table', kind: 'table' }], truncated: false });
	});

	it('opens nothing when the sub-command picker is dismissed', async () => {
		pick.mockResolvedValue(undefined);

		expect(await run()).toBeUndefined();
		expect(openEditor).not.toHaveBeenCalled();
	});

	it('says how to connect, rather than opening an empty summary, when no connection is live', async () => {
		stubServices([]);
		answerPickers('getSchema');

		expect(await run()).toBeUndefined();
		expect(info).toHaveBeenCalledWith('No active data connections. Connect to one from the Data Connections panel first.');
		expect(openEditor).not.toHaveBeenCalled();
	});

	// The agent path reads the precondition from the MenuRegistry entry that registerAction2 only
	// creates when f1 is set, and only surfaces commands flagged agentCompatible. Both are easy to
	// drop by accident, and nothing else in the build would fail if they were.
	it('keeps the descriptor fields the agent path depends on', () => {
		const { id, f1, precondition, metadata } = new DataConnectionsExecuteAction().desc;

		expect({ id, f1, precondition: precondition?.serialize(), agentCompatible: metadata?.agentCompatible })
			.toMatchInlineSnapshot(`
				{
				  "agentCompatible": true,
				  "f1": true,
				  "id": "positron.dataConnections.execute",
				  "precondition": "config.ai.enabled && config.dataConnections.enabled",
				}
			`);
	});
});
