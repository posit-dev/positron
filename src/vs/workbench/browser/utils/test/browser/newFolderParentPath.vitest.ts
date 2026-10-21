/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { posix } from '../../../../../base/common/path.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { CAN_CREATE_FOLDER_IN_COMMAND } from '../../createFolder.js';
import { resolveGitCloneParentPath, resolveNewFolderParentPath } from '../../newFolderParentPath.js';

const remoteAuthority = 'test-remote';

/**
 * The workspace on Workbench, as in the workshop report: the user home is open as the workspace,
 * so `defaultFolderPath()` returns its parent, `/home`.
 */
const workspaceParent = URI.file('/home');

/**
 * What `preferredHome()` returns: the user `files.dialog.defaultPath` value, or the user home.
 */
const preferredHome = URI.file('/home/user');

interface SetupOptions {
	/** Whether the window is remote, as on Workbench. */
	readonly remote?: boolean;
	/** The `git.defaultCloneDirectory` value; the setting defaults to `null`. */
	readonly defaultCloneDirectory?: string | null;
	/** Paths that do not exist; every other path exists. */
	readonly missing?: string[];
	/** Paths that are files; every other existing path is a folder. */
	readonly files?: string[];
	/** Whether the user cannot create a folder in the parent of the workspace. */
	readonly workspaceParentNotWritable?: boolean;
}

/**
 * Builds the services for a local or remote window.
 */
function setup(options: SetupOptions = {}) {
	const scheme = options.remote ? Schemas.vscodeRemote : Schemas.file;
	const toUri = (path: string) => options.remote
		? URI.from({ scheme, authority: remoteAuthority, path })
		: URI.file(path);
	const userHome = toUri('/user/home');
	const missing = new Set((options.missing ?? []).map(path => toUri(path).toString()));
	const files = new Set((options.files ?? []).map(path => toUri(path).toString()));

	const services = {
		commandService: stubInterface<ICommandService>({
			executeCommand: vi.fn(async (_id: string, folder: URI) =>
				!(options.workspaceParentNotWritable && folder === workspaceParent)
			) as unknown as ICommandService['executeCommand'],
		}),
		configurationService: stubInterface<IConfigurationService>({
			getValue: vi.fn(() => options.defaultCloneDirectory ?? null) as unknown as IConfigurationService['getValue'],
		}),
		fileService: stubInterface<IFileService>({
			stat: vi.fn(async (uri: URI) => {
				if (missing.has(uri.toString())) {
					throw new Error(`Unable to resolve nonexistent file '${uri}'`);
				}
				return { isDirectory: !files.has(uri.toString()) };
			}) as unknown as IFileService['stat'],
		}),
		fileDialogService: stubInterface<IFileDialogService>({
			defaultFolderPath: vi.fn(async () => workspaceParent),
			preferredHome: vi.fn(async () => preferredHome),
		}),
		pathService: stubInterface<IPathService>({
			defaultUriScheme: scheme,
			path: Promise.resolve(posix),
			fileURI: vi.fn(async (path: string) => toUri(path)),
			userHome: vi.fn(async () => userHome) as unknown as IPathService['userHome'],
		}),
		workbenchEnvironmentService: stubInterface<IWorkbenchEnvironmentService>({
			remoteAuthority: options.remote ? remoteAuthority : undefined,
		}),
		logService: stubInterface<ILogService>({ debug: vi.fn(), info: vi.fn() }),
	};
	return { services, toUri, userHome };
}

describe('resolveNewFolderParentPath', () => {
	it('uses the parent of the workspace when the user can create a folder there', async () => {
		const { services } = setup();

		expect(await resolveNewFolderParentPath(services)).toBe(workspaceParent);
		expect(services.commandService.executeCommand).toHaveBeenCalledWith(CAN_CREATE_FOLDER_IN_COMMAND, workspaceParent);
		expect(services.fileDialogService.preferredHome).not.toHaveBeenCalled();
	});

	it('uses the preferred home when the user cannot create a folder in the parent of the workspace', async () => {
		const { services } = setup({ workspaceParentNotWritable: true });

		expect(await resolveNewFolderParentPath(services)).toBe(preferredHome);
		expect(services.logService.info).toHaveBeenCalledTimes(1);
	});

	it('uses the preferred path when it is absolute and exists, without a permission check', async () => {
		const { services } = setup();

		const result = await resolveNewFolderParentPath(services, '/clones');

		expect(result.toString()).toBe(URI.file('/clones').toString());
		expect(services.commandService.executeCommand).not.toHaveBeenCalled();
	});

	it.each<[string, string, SetupOptions]>([
		['not absolute', 'clones', {}],
		['missing', '/clones', { missing: ['/clones'] }],
		['a file', '/clones', { files: ['/clones'] }],
	])('logs a preferred path that is %s and uses the parent of the workspace', async (_, preferredPath, options) => {
		const { services } = setup(options);

		expect(await resolveNewFolderParentPath(services, preferredPath)).toBe(workspaceParent);
		expect(services.logService.info).toHaveBeenCalledTimes(1);
	});

	it('expands ~ in the preferred path to the user home', async () => {
		const { services, userHome } = setup();

		expect((await resolveNewFolderParentPath(services, '~/clones')).path).toBe(`${userHome.path}/clones`);
	});

	it('expands ~ in the preferred path to the remote user home in a remote window', async () => {
		const { services, toUri } = setup({ remote: true });

		expect((await resolveNewFolderParentPath(services, '~')).toString()).toBe(toUri('/user/home').toString());
		expect(services.pathService.userHome).toHaveBeenCalledWith({ preferLocal: false });
	});

	it('does not expand ~ followed by a name', async () => {
		const { services } = setup();

		expect(await resolveNewFolderParentPath(services, '~clones')).toBe(workspaceParent);
		expect(services.pathService.userHome).not.toHaveBeenCalled();
	});
});

describe('resolveGitCloneParentPath', () => {
	it('prefers git.defaultCloneDirectory to the parent of the workspace', async () => {
		const { services } = setup({ defaultCloneDirectory: '/clones' });

		expect((await resolveGitCloneParentPath(services)).toString()).toBe(URI.file('/clones').toString());
		expect(services.configurationService.getValue).toHaveBeenCalledWith('git.defaultCloneDirectory');
	});

	it('falls back to the parent of the workspace when git.defaultCloneDirectory is not set', async () => {
		const { services } = setup();

		expect(await resolveGitCloneParentPath(services)).toBe(workspaceParent);
		expect(services.logService.info).not.toHaveBeenCalled();
	});

	it('falls back to the preferred home when git.defaultCloneDirectory is not set and the parent of the workspace is not writable', async () => {
		const { services } = setup({ workspaceParentNotWritable: true });

		expect(await resolveGitCloneParentPath(services)).toBe(preferredHome);
	});
});
