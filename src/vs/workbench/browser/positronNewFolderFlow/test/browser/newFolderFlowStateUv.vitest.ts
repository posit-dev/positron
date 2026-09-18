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
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowStateManager } from '../../newFolderFlowState.js';
import { NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';

const UV_PROVIDER = { id: 'uv-id', name: 'uv', description: 'Creates a uv environment' };

describe('NewFolderFlowStateManager uv install', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	/**
	 * Builds a state manager whose Python extension commands report uv as an available provider
	 * that is not yet installed, which is the dead end the Install uv button exists to break.
	 * @param ensureUvInstalled What the 'python.ensureUvInstalled' command resolves with.
	 */
	function createState(ensureUvInstalled: unknown) {
		let uvInstalled = false;
		const executeCommand = vi.fn(async (commandId: string) => {
			switch (commandId) {
				case 'python.getCreateEnvironmentProviders':
					return [UV_PROVIDER];
				case 'python.isUvInstalled':
					return uvInstalled;
				case 'python.getUvPythonVersions':
					return { versions: ['3.13', '3.12'] };
				case 'python.ensureUvInstalled':
					// The real command only reports ok once uv is on disk, so mirror that here.
					uvInstalled = (ensureUvInstalled as { ok?: boolean })?.ok === true;
					return ensureUvInstalled;
				default:
					return undefined;
			}
		});

		ctx.instantiationService.stub(ICommandService, {
			executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
		});
		ctx.instantiationService.stub(ILanguageRuntimeService, {
			startupPhase: RuntimeStartupPhase.Complete,
			onDidChangeRuntimeStartupPhase: Event.None,
			onDidRegisterRuntime: Event.None,
			registeredRuntimes: [],
		});
		PositronReactServices.services = ctx.reactServices;

		const state = ctx.disposables.add(new NewFolderFlowStateManager({
			parentFolder: URI.file('/Users/astrid/projects'),
			initialStep: NewFolderFlowStep.PythonEnvironment,
		}));
		state.folderTemplate = FolderTemplate.PythonProject;
		return { state, executeCommand };
	}

	/**
	 * Waits for the constructor's async initialization to settle so that assertions see the uv
	 * state the flow would really open with. The first onUpdateInterpreterState fires once the
	 * environment providers land, several awaits before uv detection answers, so wait on the uv
	 * state itself rather than on that event.
	 */
	async function initialized(state: NewFolderFlowStateManager) {
		await vi.waitFor(() => expect(state.isUvInstalled).toBeDefined());
		return state;
	}

	it('opens with uv selected, not installed, and no versions to offer', async () => {
		const { state } = createState({ ok: true });
		await initialized(state);

		expect(state.usesUvEnv).toBe(true);
		expect(state.isUvInstalled).toBe(false);
		expect(state.uvPythonVersionInfo?.versions).toEqual([]);
	});

	it('fills in the Python versions after a successful install', async () => {
		const { state } = createState({ ok: true });
		await initialized(state);

		const updated = Event.toPromise(state.onUpdateInterpreterState);
		const result = await state.installUv();
		await updated;

		expect(result.ok).toBe(true);
		expect(state.isUvInstalled).toBe(true);
		expect(state.uvPythonVersionInfo?.versions).toEqual(['3.13', '3.12']);
		expect(state.uvPythonVersion).toBe('3.13');
	});

	it('leaves the state alone when the user declines the install', async () => {
		const { state } = createState({ ok: false });
		await initialized(state);

		const result = await state.installUv();

		expect(result).toEqual({ ok: false });
		expect(state.isUvInstalled).toBe(false);
		expect(state.uvPythonVersionInfo?.versions).toEqual([]);
	});

	it('passes the install error back to the caller', async () => {
		const { state } = createState({ ok: false, error: 'uv was not found after installing it.' });
		await initialized(state);

		const result = await state.installUv();

		expect(result).toEqual({ ok: false, error: 'uv was not found after installing it.' });
		expect(state.isUvInstalled).toBe(false);
	});
});
