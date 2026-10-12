/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { CancellationError } from '../../../../../base/common/errors.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { NewFolderFlowState } from '../../newFolderFlowState.js';
import { acceptNewFolderFlow, AcceptNewFolderFlowState, createNewFolderFlowDialogHandlers } from '../../utilities/acceptNewFolderFlow.js';

describe('acceptNewFolderFlow', () => {
	const parentFolder = URI.file('/Users/astrid/projects');
	const folder = URI.joinPath(parentFolder, 'my-project');

	/**
	 * Builds the flow, services, and callbacks for one call, with every call recorded in order.
	 * @param options.exists What fileService.exists resolves with.
	 * @param options.createFolder Replaces fileService.createFolder.
	 * @param options.setUpFolder Replaces the setUpFolder callback.
	 */
	function setup(options: {
		exists?: boolean;
		createFolder?: () => Promise<unknown>;
		setUpFolder?: () => Promise<void>;
	} = {}) {
		const calls: string[] = [];
		const flow: AcceptNewFolderFlowState = {
			folderName: 'my-project',
			parentFolder,
			getState: vi.fn(() => {
				calls.push('getState');
				return {
					selectedRuntime: undefined,
					folderTemplate: undefined,
					folderName: flow.folderName,
					parentFolder: flow.parentFolder,
					initGitRepo: true,
					openInNewWindow: true,
					createPyprojectToml: undefined,
					pythonEnvSetupType: undefined,
					pythonEnvProviderId: undefined,
					pythonEnvName: undefined,
					condaPythonVersion: undefined,
					uvPythonVersion: undefined,
					pythonEnvProviderName: undefined,
					installIpykernel: undefined,
					useRenv: undefined,
				};
			}),
		};
		const fileService = stubInterface<IFileService>({
			exists: vi.fn(async () => options.exists ?? false),
			createFolder: vi.fn(async () => {
				calls.push('createFolder');
				return options.createFolder?.();
			}) as unknown as IFileService['createFolder'],
		});
		const logService = stubInterface<ILogService>({ error: vi.fn() });
		const notificationService = stubInterface<INotificationService>({ error: vi.fn() });
		const dispose = vi.fn(() => { calls.push('dispose'); });
		const setUpFolder = vi.fn(async (_state: NewFolderFlowState, _folder: URI, _existed: boolean) => {
			calls.push('setUpFolder');
			await options.setUpFolder?.();
		});
		const accept = () => acceptNewFolderFlow(
			flow,
			{ fileService, logService, notificationService },
			dispose,
			setUpFolder
		);
		return { calls, flow, fileService, logService, notificationService, dispose, setUpFolder, accept };
	}

	it('keeps the dialog open and notifies when the folder cannot be created', async () => {
		// The Folder Name and Location step checks the location, so this is a location that
		// became unusable after that check.
		const { calls, flow, logService, notificationService, accept } = setup({
			createFolder: async () => { throw new Error('ENOSPC: no space left on device'); },
		});

		await expect(accept()).resolves.toBeUndefined();

		expect(calls).toEqual(['createFolder']);
		expect(flow.getState).not.toHaveBeenCalled();
		expect(logService.error).toHaveBeenCalledTimes(1);
		expect(notificationService.error).toHaveBeenCalledWith(
			'Could not create the folder: ENOSPC: no space left on device'
		);
	});

	it('creates the folder, takes the snapshot, then closes the dialog and sets up the folder', async () => {
		const { calls, setUpFolder, notificationService, accept } = setup();

		await accept();

		expect(calls).toEqual(['createFolder', 'getState', 'dispose', 'setUpFolder']);
		expect(notificationService.error).not.toHaveBeenCalled();
		expect(setUpFolder).toHaveBeenCalledWith(
			expect.objectContaining({ folderName: 'my-project', parentFolder, initGitRepo: true }),
			folder,
			false
		);
	});

	it('does not create a folder that already exists', async () => {
		const { calls, fileService, setUpFolder, accept } = setup({ exists: true });

		await accept();

		expect(fileService.createFolder).not.toHaveBeenCalled();
		expect(calls).toEqual(['getState', 'dispose', 'setUpFolder']);
		expect(setUpFolder).toHaveBeenCalledWith(expect.anything(), folder, true);
	});

	it('reports a setup failure in a notification instead of rejecting', async () => {
		const { notificationService, logService, accept } = setup({
			setUpFolder: async () => { throw new Error('openFolder failed'); },
		});

		await expect(accept()).resolves.toBeUndefined();

		expect(notificationService.error).toHaveBeenCalledTimes(1);
		const message = vi.mocked(notificationService.error).mock.calls[0][0];
		expect(message).toContain('my-project');
		expect(message).toContain('openFolder failed');
		expect(logService.error).toHaveBeenCalledTimes(1);
	});

	it('does not report a cancelled setup', async () => {
		const { notificationService, logService, accept } = setup({
			setUpFolder: async () => { throw new CancellationError(); },
		});

		await expect(accept()).resolves.toBeUndefined();

		expect(notificationService.error).not.toHaveBeenCalled();
		expect(logService.error).not.toHaveBeenCalled();
	});

	it('uses the folder name and location from the start of the call', async () => {
		const test = setup({
			// The Folder Name input stays editable while the folder is created.
			createFolder: async () => { test.flow.folderName = 'renamed'; },
		});

		await test.accept();

		expect(test.setUpFolder).toHaveBeenCalledWith(
			expect.objectContaining({ folderName: 'my-project', parentFolder }),
			folder,
			false
		);
	});

});

describe('createNewFolderFlowDialogHandlers', () => {
	/**
	 * Builds the handlers around an accept that stays pending until the test finishes it.
	 */
	function setup() {
		let finishAccept!: () => void;
		const accept = vi.fn(() => new Promise<void>(resolve => { finishAccept = resolve; }));
		const close = vi.fn();
		const handlers = createNewFolderFlowDialogHandlers(accept, close);
		return { accept, close, handlers, finishAccept: () => finishAccept() };
	}

	it('ignores an accept that arrives after the dialog was cancelled', async () => {
		// Create on the Empty Project step checks the location before it calls accept, so the
		// user can cancel in between.
		const accept = vi.fn(async () => undefined);
		const close = vi.fn();
		const handlers = createNewFolderFlowDialogHandlers(accept, close);

		handlers.cancel();
		await handlers.accept();

		expect({ accepts: accept.mock.calls.length, closes: close.mock.calls.length })
			.toEqual({ accepts: 0, closes: 1 });
	});

	it('ignores cancel and a second accept while an accept is in flight', async () => {
		const { accept, close, handlers, finishAccept } = setup();

		const first = handlers.accept();
		await handlers.accept();
		handlers.cancel();
		finishAccept();
		await first;

		expect({ accepts: accept.mock.calls.length, closes: close.mock.calls.length })
			.toEqual({ accepts: 1, closes: 0 });
	});

	it('allows a retry and a cancel once an accept has finished without closing the dialog', async () => {
		const { accept, close, handlers, finishAccept } = setup();

		const first = handlers.accept();
		finishAccept();
		await first;
		const retry = handlers.accept();
		finishAccept();
		await retry;
		handlers.cancel();

		expect({ accepts: accept.mock.calls.length, closes: close.mock.calls.length })
			.toEqual({ accepts: 2, closes: 1 });
	});
});
