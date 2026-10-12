/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowStateManager } from '../../newFolderFlowState.js';
import { EnvironmentSetupType, NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';
import { acceptNewFolderFlow } from '../../utilities/acceptNewFolderFlow.js';

const VENV_PROVIDER = { id: 'venv-id', name: 'Venv', description: 'Creates a venv environment' };

describe('acceptNewFolderFlow with the real state manager', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	/**
	 * Builds a state manager on the Python Environment step, where Create is pressed.
	 */
	function createState() {
		ctx.instantiationService.stub(ICommandService, {
			executeCommand: vi.fn(async (commandId: string) => {
				switch (commandId) {
					case 'python.getCreateEnvironmentProviders':
						return [VENV_PROVIDER];
					case 'python.isUvInstalled':
						return false;
					default:
						return undefined;
				}
			}) as unknown as ICommandService['executeCommand'],
		});
		ctx.instantiationService.stub(ILanguageRuntimeService, {
			startupPhase: RuntimeStartupPhase.Complete,
			onDidChangeRuntimeStartupPhase: Event.None,
			onDidRegisterRuntime: Event.None,
			registeredRuntimes: [],
		});
		// NewFolderFlowStateManager reads the services singleton in its constructor.
		PositronReactServices.services = ctx.reactServices;

		return ctx.disposables.add(new NewFolderFlowStateManager({
			parentFolder: URI.file('/Users/astrid/projects'),
			initialStep: NewFolderFlowStep.PythonEnvironment,
		}));
	}

	it('keeps the Python choices when the folder cannot be created', async () => {
		const state = createState();
		state.folderTemplate = FolderTemplate.PythonProject;
		await vi.waitFor(() => expect(state.pythonEnvProvider).toBe(VENV_PROVIDER.id));
		state.folderName = 'my-project';
		state.pythonEnvSetupType = EnvironmentSetupType.ExistingEnvironment;
		state.pythonEnvProvider = VENV_PROVIDER.id;

		const notifyError = vi.fn();
		await acceptNewFolderFlow(
			state,
			{
				fileService: stubInterface<IFileService>({
					exists: vi.fn(async () => false),
					createFolder: vi.fn(async () => { throw new Error('EACCES'); }),
				}),
				logService: stubInterface<ILogService>({ error: vi.fn() }),
				notificationService: stubInterface<INotificationService>({ error: notifyError }),
			},
			() => { },
			async () => { }
		);

		expect({ notified: notifyError.mock.calls.length, pythonEnvProvider: state.pythonEnvProvider }).toEqual({
			notified: 1,
			pythonEnvProvider: VENV_PROVIDER.id,
		});
	});
});
