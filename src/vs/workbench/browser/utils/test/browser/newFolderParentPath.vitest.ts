/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Schemas } from '../../../../../base/common/network.js';
import { posix, win32 } from '../../../../../base/common/path.js';
// vs/test/vitest/** is allow-listed for test files (eslint.config.js), but the rule does not
// recognize src/vs/workbench/browser/<feature>/test/ as a test path, so it flags the import.
// eslint-disable-next-line local/code-import-patterns
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IConfigurationService, IConfigurationValue } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IPathService } from '../../../../services/path/common/pathService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { resolveGitCloneParentPath, resolveNewFolderParentPath } from '../../newFolderParentPath.js';

const remoteAuthority = 'test-remote';

/**
 * The parent of a `/cloud/project` workspace, which `defaultFolderPath()` returns.
 */
const workspaceParent = URI.file('/cloud');

interface SetupOptions {
	/** Whether the window is remote, as on Workbench. */
	readonly remote?: boolean;
	/** Whether the target OS is Windows. */
	readonly windows?: boolean;
	/** The `files.dialog.defaultPath` values. */
	readonly defaultPath?: Pick<IConfigurationValue<string>, 'policyValue' | 'userLocalValue' | 'userRemoteValue'>;
	/** The `git.defaultCloneDirectory` value; the setting defaults to `null`. */
	readonly defaultCloneDirectory?: string | null;
	/** Paths that do not exist; every other path exists. */
	readonly missing?: string[];
}

/**
 * Builds the services for a local or remote window.
 */
function setup(options: SetupOptions = {}) {
	const scheme = options.remote ? Schemas.vscodeRemote : Schemas.file;
	const toUri = (path: string) => options.remote
		? URI.from({ scheme, authority: remoteAuthority, path })
		: URI.file(path);
	const userHome = options.windows ? URI.file('c:/Users/x') : toUri('/user/home');
	const missing = new Set((options.missing ?? []).map(path => toUri(path).toString()));

	const services = {
		configurationService: stubInterface<IConfigurationService>({
			inspect: vi.fn(() => ({ value: undefined, ...options.defaultPath })) as unknown as IConfigurationService['inspect'],
			getValue: vi.fn(() => options.defaultCloneDirectory ?? null) as unknown as IConfigurationService['getValue'],
		}),
		fileService: stubInterface<IFileService>({
			exists: vi.fn(async (uri: URI) => !missing.has(uri.toString())),
		}),
		fileDialogService: stubInterface<IFileDialogService>({
			defaultFolderPath: vi.fn(async () => workspaceParent),
		}),
		pathService: stubInterface<IPathService>({
			defaultUriScheme: scheme,
			path: Promise.resolve(options.windows ? win32 : posix),
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
	it('uses the preferred path when it is absolute and exists', async () => {
		const { services } = setup({ defaultPath: { userLocalValue: '/dialogs' } });

		const result = await resolveNewFolderParentPath(services, '/clones');

		expect(result.toString()).toBe(URI.file('/clones').toString());
		expect(services.fileDialogService.defaultFolderPath).not.toHaveBeenCalled();
	});

	it.each([
		['not absolute', 'clones'],
		['missing', '/clones'],
	])('logs a preferred path that is %s and uses files.dialog.defaultPath', async (_, preferredPath) => {
		const { services } = setup({ defaultPath: { userLocalValue: '/dialogs' }, missing: ['/clones'] });

		const result = await resolveNewFolderParentPath(services, preferredPath);

		expect(result.toString()).toBe(URI.file('/dialogs').toString());
		expect(services.logService.info).toHaveBeenCalledTimes(1);
	});

	it('uses the parent of the workspace when nothing is set', async () => {
		const { services } = setup();

		expect(await resolveNewFolderParentPath(services)).toBe(workspaceParent);
		expect(services.logService.info).not.toHaveBeenCalled();
	});

	it('prefers a files.dialog.defaultPath user value to the parent of the workspace', async () => {
		const { services } = setup({ defaultPath: { userLocalValue: '/dialogs' } });

		expect((await resolveNewFolderParentPath(services)).toString()).toBe(URI.file('/dialogs').toString());
	});

	it('prefers a files.dialog.defaultPath policy value to the user value', async () => {
		const { services } = setup({ defaultPath: { policyValue: '/enforced', userLocalValue: '/dialogs' } });

		expect((await resolveNewFolderParentPath(services)).toString()).toBe(URI.file('/enforced').toString());
	});

	it('reads the remote user value in a remote window, and ignores the local one', async () => {
		const { services, toUri } = setup({ remote: true, defaultPath: { userLocalValue: '/local', userRemoteValue: '/remote' } });

		expect((await resolveNewFolderParentPath(services)).toString()).toBe(toUri('/remote').toString());
	});

	it('ignores a local user value in a remote window (the Workbench User tab case)', async () => {
		const { services } = setup({ remote: true, defaultPath: { userLocalValue: '/local' } });

		expect(await resolveNewFolderParentPath(services)).toBe(workspaceParent);
	});

	it.each([
		['~', ''],
		['~/clones', '/clones'],
		['~/a/b', '/a/b'],
		['~/a//b/', '/a/b'],
	])('expands a preferred path of %s to the user home', async (preferredPath, rest) => {
		const { services, userHome } = setup();

		const result = await resolveNewFolderParentPath(services, preferredPath);

		expect(result.path).toBe(userHome.path + rest);
	});

	it('splits on backslashes for a Windows target', async () => {
		const { services } = setup({ windows: true });

		const result = await resolveNewFolderParentPath(services, '~\\clones');

		expect(result.path).toBe('/c:/Users/x/clones');
	});

	it('keeps a backslash as part of a name for a POSIX target', async () => {
		const { services, userHome } = setup();

		const result = await resolveNewFolderParentPath(services, '~/a\\b');

		expect(result.path).toBe(`${userHome.path}/a\\b`);
	});

	it('does not expand ~ followed by a name', async () => {
		const { services } = setup();

		expect(await resolveNewFolderParentPath(services, '~clones')).toBe(workspaceParent);
		expect(services.pathService.userHome).not.toHaveBeenCalled();
	});

	it.each([
		['~', ''],
		['~/projects', '/projects'],
	])('expands a files.dialog.defaultPath policy value of %s to the user home', async (policyValue, rest) => {
		const { services, userHome } = setup({ defaultPath: { policyValue } });

		expect((await resolveNewFolderParentPath(services)).path).toBe(userHome.path + rest);
	});

	it('expands a policy value to the remote user home in a remote window', async () => {
		const { services, toUri } = setup({ remote: true, defaultPath: { policyValue: '~' } });

		expect((await resolveNewFolderParentPath(services)).toString()).toBe(toUri('/user/home').toString());
		expect(services.pathService.userHome).toHaveBeenCalledWith({ preferLocal: false });
	});

	it('logs a missing policy value and uses the parent of the workspace', async () => {
		const { services } = setup({ defaultPath: { policyValue: '/enforced' }, missing: ['/enforced'] });

		expect(await resolveNewFolderParentPath(services)).toBe(workspaceParent);
		expect(services.logService.info).toHaveBeenCalledTimes(1);
	});

	it('does not expand ~ in a files.dialog.defaultPath user value', async () => {
		const { services } = setup({ defaultPath: { userLocalValue: '~/clones' } });

		expect(await resolveNewFolderParentPath(services)).toBe(workspaceParent);
		expect(services.logService.info).not.toHaveBeenCalled();
	});
});

describe('resolveGitCloneParentPath', () => {
	it('prefers git.defaultCloneDirectory to files.dialog.defaultPath', async () => {
		const { services } = setup({ defaultCloneDirectory: '/clones', defaultPath: { userLocalValue: '/dialogs' } });

		expect((await resolveGitCloneParentPath(services)).toString()).toBe(URI.file('/clones').toString());
		expect(services.configurationService.getValue).toHaveBeenCalledWith('git.defaultCloneDirectory');
	});

	it('falls back to files.dialog.defaultPath when git.defaultCloneDirectory is not set', async () => {
		const { services } = setup({ defaultPath: { userLocalValue: '/dialogs' } });

		expect((await resolveGitCloneParentPath(services)).toString()).toBe(URI.file('/dialogs').toString());
		expect(services.logService.info).not.toHaveBeenCalled();
	});

	it('falls back to the parent of the workspace when nothing is set', async () => {
		const { services } = setup();

		expect(await resolveGitCloneParentPath(services)).toBe(workspaceParent);
		expect(services.logService.info).not.toHaveBeenCalled();
	});
});
