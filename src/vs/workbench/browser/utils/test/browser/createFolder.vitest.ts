/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createFileSystemProviderError, FileSystemProviderErrorCode } from '../../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { CAN_CREATE_FOLDER_IN_COMMAND, checkCanCreateFolderIn, createFolderErrorMessage } from '../../createFolder.js';

describe('createFolderErrorMessage', () => {
	it('explains a permission error in plain words', () => {
		const error = createFileSystemProviderError(
			'EACCES: permission denied, mkdir \'/cloud/my-project\'',
			FileSystemProviderErrorCode.NoPermissions
		);

		expect(createFolderErrorMessage(error)).toBe('You don\'t have permission to create a folder in this location.');
	});

	it('includes the cause of any other error', () => {
		expect(createFolderErrorMessage(new Error('ENOSPC: no space left on device')))
			.toBe('Could not create the folder: ENOSPC: no space left on device');
	});
});

describe('checkCanCreateFolderIn', () => {
	const parentFolder = URI.file('/cloud');

	/**
	 * Builds the services, with the extension host's answer to whether a folder can be created.
	 * @param answer Replaces the command, which runs in the extension host.
	 */
	function setup(answer: () => Promise<boolean | undefined> = async () => true) {
		const executeCommand = vi.fn(answer);
		const services = {
			commandService: stubInterface<ICommandService>({
				executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
			}),
			logService: stubInterface<ILogService>({ info: vi.fn() }),
		};
		return { executeCommand, services, check: () => checkCanCreateFolderIn(parentFolder, services) };
	}

	it('asks the extension host about the folder', async () => {
		const { executeCommand, check } = setup();

		expect(await check()).toBeUndefined();
		expect(executeCommand).toHaveBeenCalledWith(CAN_CREATE_FOLDER_IN_COMMAND, parentFolder);
	});

	it('explains that the user cannot write to the folder', async () => {
		const { check } = setup(async () => false);

		expect(await check()).toBe('You don\'t have permission to create a folder in this location.');
	});

	it('leaves it to the real creation when the extension host cannot tell', async () => {
		const { check } = setup(async () => undefined);

		expect(await check()).toBeUndefined();
	});

	it('leaves it to the real creation when the extension host cannot be asked', async () => {
		const { services, check } = setup(async () => { throw new Error('command not found'); });

		expect(await check()).toBeUndefined();
		expect(services.logService.info).toHaveBeenCalledTimes(1);
	});
});
