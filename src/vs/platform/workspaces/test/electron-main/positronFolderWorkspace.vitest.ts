/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { IBackupMainService } from '../../../backup/electron-main/backup.js';
import { INativeWindowConfiguration } from '../../../window/common/window.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';
import { IWorkspaceIdentifier } from '../../../workspace/common/workspace.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { enterCanvasFolder, ICanvasFolderFs, resolveCanvasFolder } from '../../electron-main/positronFolderWorkspace.js';
import { getSingleFolderWorkspaceIdentifier } from '../../node/workspaces.js';

const posixOnly = it.skipIf(process.platform === 'win32');

describe('Canvas folder switch (main process)', () => {
	let root: string;
	let target: string;
	let window: ICodeWindow;
	let config: Pick<INativeWindowConfiguration, 'workspace' | 'backupPath' | 'extensionDevelopmentPath'>;
	const registerFolderBackup = vi.fn(() => '/backup/new');
	const backups = stubInterface<IBackupMainService>({ registerFolderBackup });

	/** A ready, local, single-folder window on `folder`, with `overrides` applied. */
	async function createWindow(id: number, folder: string, overrides: Partial<ICodeWindow> = {}): Promise<ICodeWindow> {
		const workspace = getSingleFolderWorkspaceIdentifier(URI.file(folder), await fs.stat(folder));
		// Every property the switch reads is set: an unset read on a stub throws.
		const windowConfig = stubInterface<INativeWindowConfiguration>({ workspace, backupPath: '/backup/old', extensionDevelopmentPath: undefined });
		return stubInterface<ICodeWindow>({
			id,
			isReady: true,
			remoteAuthority: undefined,
			config: windowConfig,
			get openedWorkspace() { return windowConfig.workspace; },
			...overrides
		});
	}

	/** The identity an ordinary File > Open Folder would give `folder`. */
	async function identityOf(folder: string) {
		return getSingleFolderWorkspaceIdentifier(URI.file(folder), await fs.stat(folder));
	}

	/** The real filesystem, except that `realpath` rejects for `unreadable`. */
	function fsUnreadableAt(unreadable: string): ICanvasFolderFs {
		return {
			stat: fs.stat,
			realpath: path => path === unreadable ? Promise.reject(new Error('EACCES')) : fs.realpath(path)
		};
	}

	beforeEach(async () => {
		// Real path: macOS's temp dir is a symlink, and the tests below compare against physical paths.
		root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'canvas-folder-switch-')));
		target = join(root, 'target');
		await fs.mkdir(target);
		window = await createWindow(1, root);
		config = window.config!;
	});

	afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

	describe('resolveCanvasFolder', () => {
		it('returns the identifier of the path as given and changes nothing', async () => {
			const before = { ...config };
			await expect(resolveCanvasFolder(window, [window], URI.file(target))).resolves.toEqual({ workspace: await identityOf(target), physicalUri: URI.file(target) });
			expect(config).toEqual(before);
		});

		posixOnly('keeps an alias as the identity and reports where it leads', async () => {
			const alias = join(root, 'link');
			await fs.symlink(target, alias);
			await expect(resolveCanvasFolder(window, [window], URI.file(alias))).resolves.toEqual({ workspace: await identityOf(alias), physicalUri: URI.file(target) });
		});

		it('gives a trailing separator the same identifier as the bare path', async () => {
			const [withSeparator, bare] = await Promise.all([
				resolveCanvasFolder(window, [window], URI.file(target + '/')),
				resolveCanvasFolder(window, [window], URI.file(target)),
			]);
			expect(withSeparator).toEqual(bare);
		});

		it.each([
			['a missing folder', () => URI.file(join(root, 'missing')), 'does not exist'],
			['a file', () => URI.file(join(root, 'file')), 'is not a folder'],
			['a remote folder', () => URI.parse('vscode-remote://host/project'), 'local folder'],
		])('rejects %s with a user-presentable message', async (_name, folder, message) => {
			await fs.writeFile(join(root, 'file'), 'keep');
			await expect(resolveCanvasFolder(window, [window], folder())).rejects.toThrow(message);
		});

		it('rejects a folder already owned by another window', async () => {
			const other = await createWindow(2, target);
			await expect(resolveCanvasFolder(window, [window, other], URI.file(target))).rejects.toThrow('another Positron window');
		});

		posixOnly('rejects an alias of a folder another window owns on its real path', async () => {
			const alias = join(root, 'link');
			await fs.symlink(target, alias);
			const other = await createWindow(2, target);
			await expect(resolveCanvasFolder(window, [window, other], URI.file(alias))).rejects.toThrow('another Positron window');
		});

		posixOnly('rejects the real path of a folder another window owns through an alias', async () => {
			const alias = join(root, 'link');
			await fs.symlink(target, alias);
			const other = await createWindow(2, alias);
			await expect(resolveCanvasFolder(window, [window, other], URI.file(target))).rejects.toThrow('another Positron window');
		});

		it('accepts the folder the window itself already shows', async () => {
			await expect(resolveCanvasFolder(window, [window], URI.file(root))).resolves.toEqual({ workspace: window.openedWorkspace, physicalUri: URI.file(root) });
		});

		posixOnly('returns the current identifier when the current folder is requested through an alias', async () => {
			const alias = join(root, 'self');
			await fs.symlink(root, alias);
			await expect(resolveCanvasFolder(window, [window], URI.file(alias))).resolves.toEqual({ workspace: window.openedWorkspace, physicalUri: URI.file(root) });
		});

		it('skips a peer window whose folder cannot be read', async () => {
			const unreadable = join(root, 'unreadable');
			await fs.mkdir(unreadable);
			const other = await createWindow(2, unreadable);
			await expect(resolveCanvasFolder(window, [window, other], URI.file(target), fsUnreadableAt(unreadable))).resolves.toEqual({ workspace: await identityOf(target), physicalUri: URI.file(target) });
		});

		it.each<[string, Partial<ICodeWindow> | undefined]>([
			['not loaded', { isReady: false }],
			['remote', { remoteAuthority: 'ssh-remote+host' }],
			['multi-root', { openedWorkspace: { id: 'w', configPath: URI.file('/w.code-workspace') } satisfies IWorkspaceIdentifier }],
			['empty', { openedWorkspace: undefined }],
			['missing', undefined],
		])('rejects when the window is %s', async (_name, overrides) => {
			const unsuitable = overrides && await createWindow(3, root, overrides);
			await expect(resolveCanvasFolder(unsuitable, unsuitable ? [unsuitable] : [], URI.file(target))).rejects.toThrow('single-folder window');
		});
	});

	describe('enterCanvasFolder', () => {
		it('commits the folder identity and a fresh backup home without focusing the window', async () => {
			const result = await enterCanvasFolder(window, [window], backups, URI.file(target));
			expect(result).toEqual({ workspace: await identityOf(target), backupPath: '/backup/new' });
			expect({ workspace: config.workspace, backupPath: config.backupPath }).toEqual(result);
			// The window stub has no `focus`: a call would throw on the unset read.
			expect(registerFolderBackup).toHaveBeenCalledWith({ folderUri: result.workspace.uri, remoteAuthority: undefined });
		});

		it('keeps extension development windows without a backup home', async () => {
			config.extensionDevelopmentPath = ['/ext'];
			const result = await enterCanvasFolder(window, [window], backups, URI.file(target));
			expect(result.backupPath).toBeUndefined();
			expect(registerFolderBackup).not.toHaveBeenCalled();
		});

		it('leaves the window untouched when the folder is rejected', async () => {
			const before = { ...config };
			await expect(enterCanvasFolder(window, [window], backups, URI.file(join(root, 'missing')))).rejects.toThrow();
			expect(config).toEqual(before);
			expect(registerFolderBackup).not.toHaveBeenCalled();
		});
	});
});
