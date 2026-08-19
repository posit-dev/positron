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
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeSessionState, RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronPackagesService } from '../../browser/interfaces/positronPackagesService.js';
import { PACKAGES_GET_PACKAGES_COMMAND_ID } from '../../browser/positronPackagesCommands.js';
import { IPositronPackagesInstance } from '../../browser/positronPackagesInstance.js';
import { ShowPackagesAction } from '../../browser/positronPackagesInspectActions.js';

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
	packages: [{
		name: 'numpy',
		version: '2.1.0',
		latestVersion: undefined,
		outdated: false,
		attached: undefined,
		description: undefined,
		url: undefined,
	}],
};

describe('packages inspect action', () => {
	const ctx = createTestContainer().build();

	let openEditor: ReturnType<typeof vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>>;

	beforeEach(() => {
		openEditor = vi.fn<(input: IUntitledTextResourceEditorInput) => Promise<undefined>>();

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
		ctx.instantiationService.stub(IPositronPackagesService, stubInterface<IPositronPackagesService>({
			activePackagesInstance: stubInterface<IPositronPackagesInstance>({
				session,
				getPackagesSnapshot: vi.fn(async () => ({
					metadataStatus: 'fresh' as const,
					packages: [{ id: 'numpy-2.1.0', name: 'numpy', displayName: 'numpy', version: '2.1.0', outdated: false }],
				})),
			}),
		}));
		// openEditor is generic over its argument type; the cast tells the compiler what this mock
		// already is, the way positronDataConnectionsInspectActions.vitest.ts stubs it.
		ctx.instantiationService.stub(IEditorService, stubInterface<IEditorService>({
			openEditor: openEditor as unknown as IEditorService['openEditor'],
		}));
	});

	// The JSON contents are the whole point of the action: they're what a developer reads to see
	// exactly what Assistant gets from the command it wraps.
	it('shows the packages payload as JSON', async () => {
		await ctx.instantiationService.invokeFunction(accessor => new ShowPackagesAction().run(accessor));

		expect(openEditor).toHaveBeenCalledWith({
			resource: undefined,
			contents: JSON.stringify(PACKAGES_PAYLOAD, null, 2),
			languageId: 'json',
			options: { pinned: true },
		});
	});

	it('is offered in the Command Palette only while the Packages pane is enabled', () => {
		const item = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.find(menuItem => menuItem.command.id === 'positronPackages.showPackages');

		expect(item?.command.precondition?.serialize())
			.toBe('config.packages.enabled && config.positron.packages.enable');
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
