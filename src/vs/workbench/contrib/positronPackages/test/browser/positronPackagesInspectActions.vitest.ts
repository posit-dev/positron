/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { MenuId, MenuRegistry, isIMenuItem } from '../../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IProgress, IProgressOptions, IProgressService, IProgressStep, ProgressLocation } from '../../../../../platform/progress/common/progress.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSessionState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { PACKAGES_GET_PACKAGES_COMMAND_ID } from '../../browser/positronPackagesCommands.js';
import { IPackagesSnapshot, IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';
import { ShowPackagesAction } from '../../browser/positronPackagesInspectActions.js';

/** The Package Manager instance the cached advisories came from. */
const SOURCE = { host: 'ppm.example.com', fetchedAt: Date.parse('2026-08-19T10:00:00.000Z') };

const NUMPY = { id: 'numpy-2.1.0', name: 'numpy', displayName: 'numpy', version: '2.1.0', outdated: false };

/** The snapshot the session reports by default: a lookup has answered. */
const ANSWERED_SNAPSHOT: IPackagesSnapshot = {
	metadataStatus: 'fresh',
	vulnerabilityStatus: 'cached',
	vulnerabilitySource: SOURCE,
	packages: [NUMPY],
};

// The payload both the action and a programmatic caller should see: one installed package in a
// session that can answer.
const PACKAGES_PAYLOAD = {
	available: true,
	session: {
		sessionId: 'session-1',
		sessionName: 'Python 3.12.4',
		languageId: 'python',
		languageName: 'Python',
		languageVersion: '3.12.4',
		runtimeName: 'Python 3.12.4 (.venv)',
	},
	metadataStatus: 'fresh',
	vulnerabilityStatus: 'cached',
	vulnerabilitySource: { host: 'ppm.example.com', fetchedAt: '2026-08-19T10:00:00.000Z' },
	packages: [{
		name: 'numpy',
		version: '2.1.0',
		latestVersion: undefined,
		outdated: false,
		attached: undefined,
		description: undefined,
		url: undefined,
		vulnerabilities: undefined,
	}],
};

describe('packages inspect action', () => {
	const ctx = createTestContainer().build();

	let openEditor: ReturnType<typeof vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>>;
	let getPackagesSnapshot: ReturnType<typeof vi.fn<IPositronPackagesInstance['getPackagesSnapshot']>>;
	// withProgress is generic over what the task resolves to; the mock is typed against a single
	// concrete instantiation of it, the way openEditor is stubbed below.
	let withProgress: ReturnType<typeof vi.fn<(options: IProgressOptions, task: (progress: IProgress<IProgressStep>) => Promise<unknown>) => Promise<unknown>>>;

	/** What the session reports; a test reassigns this before running the action. */
	let snapshot: IPackagesSnapshot;

	beforeEach(() => {
		openEditor = vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>();
		snapshot = ANSWERED_SNAPSHOT;

		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'session-1',
			dynState: stubInterface<ILanguageRuntimeSessionState>({ sessionName: 'Python 3.12.4' }),
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				languageId: 'python',
				languageName: 'Python',
				languageVersion: '3.12.4',
				runtimeName: 'Python 3.12.4 (.venv)',
			}),
			getRuntimeState: () => RuntimeState.Idle,
		});

		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'packages.enabled': true,
			'positron.packages.enable': true,
		}));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		getPackagesSnapshot = vi.fn(async () => snapshot);
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activePackagesInstance: stubInterface<IPositronPackagesInstance>({
				session,
				getPackagesSnapshot,
			}),
		}));
		// openEditor is generic over its argument type; the cast tells the compiler what this mock
		// already is, the way positronDataConnectionsInspectActions.vitest.ts stubs it.
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({
			openEditor: openEditor as unknown as IEditorService['openEditor'],
		}));

		withProgress = vi.fn((_options: IProgressOptions, task: (progress: IProgress<IProgressStep>) => Promise<unknown>) => task({ report: () => { } }));
		ctx.instantiationService.stub(IProgressService, stubInterface<IProgressService>({
			withProgress: withProgress as unknown as IProgressService['withProgress'],
		}));
	});

	/** Runs the Command Palette action. */
	async function runAction(): Promise<void> {
		await ctx.instantiationService.invokeFunction(accessor => new ShowPackagesAction().run(accessor));
	}

	/** The JSON the action opened, parsed back. */
	function shownPayload(): { vulnerabilityStatus: string } {
		return JSON.parse(openEditor.mock.calls[0][0].contents!);
	}

	// The JSON contents are the whole point of the action: they're what a developer reads to see
	// exactly what Assistant gets from the command it wraps.
	it('shows the packages payload as JSON', async () => {
		await runAction();

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(PACKAGES_PAYLOAD, null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
		// One read: the command fills its own advisory gaps, so the action has
		// no reason to call it twice.
		expect(getPackagesSnapshot).toHaveBeenCalledTimes(1);
	});

	// The read fills its own gaps, so on a cold cache it queries the repositories and Package
	// Manager before answering: seconds of silence that would read as a hang. The delay is what
	// keeps a warm cache -- which answers immediately -- from flashing a notification for nothing.
	it('reports progress once the read is slow enough to look like a hang', async () => {
		await runAction();

		expect(withProgress).toHaveBeenCalledWith(
			expect.objectContaining({ location: ProgressLocation.Notification, delay: 500 }),
			expect.any(Function),
		);
	});

	it('shows the payload even when no advisories could be obtained', async () => {
		// 'unavailable' is an answer, not a failure: the packages and their
		// outdated state are still what the developer opened this to read.
		snapshot = { ...ANSWERED_SNAPSHOT, vulnerabilityStatus: 'unavailable', vulnerabilitySource: undefined };

		await runAction();

		expect(shownPayload().vulnerabilityStatus).toBe('unavailable');
	});

	it('is offered in the Command Palette only while the Packages pane is enabled', () => {
		const item = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.find(menuItem => menuItem.command.id === 'positronPackages.showPackages');

		expect(item?.command.precondition?.serialize())
			.toBe('config.packages.enabled && config.positron.packages.enable');
	});

	// The action is the user-facing half of the split: it shows progress and opens an editor, neither
	// of which belongs in an agent's flow. Agent discovery keys off metadata.agentCompatible, which
	// registerAction2 never sets, so the guard is that nobody adds it by hand later.
	it('is not advertised to AI agents, unlike the payload command it wraps', () => {
		expect(CommandsRegistry.getCommand('positronPackages.showPackages')?.metadata?.agentCompatible).toBeFalsy();
		expect(CommandsRegistry.getCommand(PACKAGES_GET_PACKAGES_COMMAND_ID)?.metadata?.agentCompatible).toBe(true);
	});

	// The property Assistant depends on: executing the payload command hands the JSON back to the
	// caller and leaves the workbench alone. Opening an editor is what the action above is for, and
	// wiring one into the payload command's handler by mistake would put a file in the user's face
	// every time Assistant asked what packages are installed.
	it('returns the payload to a programmatic caller without opening an editor', async () => {
		// The registry types every handler as returning void; this one returns its payload, which is
		// what executeCommand passes back to the caller.
		const handler = CommandsRegistry.getCommand(PACKAGES_GET_PACKAGES_COMMAND_ID)?.handler as
			((accessor: ServicesAccessor) => Promise<unknown>) | undefined;

		const result = await ctx.instantiationService.invokeFunction(accessor => handler!(accessor));

		expect(result).toEqual(PACKAGES_PAYLOAD);
		expect(openEditor).not.toHaveBeenCalled();
	});
});
