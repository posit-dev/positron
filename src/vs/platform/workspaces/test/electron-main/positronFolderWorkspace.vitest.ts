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
import { enterCanvasFolder, resolveCanvasFolder } from '../../electron-main/positronFolderWorkspace.js';
import { getSingleFolderWorkspaceIdentifier } from '../../node/workspaces.js';

describe('Canvas folder switch (main process)', () => {
	let root: string;
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
			focus: vi.fn(),
			...overrides
		});
	}

	beforeEach(async () => {
		// Canonical: macOS's temp dir is a symlink, and identities compare canonical paths.
		root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'canvas-folder-switch-')));
		await fs.mkdir(join(root, 'target'));
		window = await createWindow(1, root);
		config = window.config!;
	});

	afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

	describe('resolveCanvasFolder', () => {
		it('returns the canonical identifier and changes nothing', async () => {
			await fs.symlink(join(root, 'target'), join(root, 'link'));
			const before = { ...config };
			const workspace = await resolveCanvasFolder(window, [window], URI.file(join(root, 'link')));
			const canonical = URI.file(await fs.realpath(join(root, 'target')));
			expect(workspace).toEqual(getSingleFolderWorkspaceIdentifier(canonical, await fs.stat(canonical.fsPath)));
			expect(config).toEqual(before);
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
			const other = await createWindow(2, join(root, 'target'));
			await expect(resolveCanvasFolder(window, [window, other], URI.file(join(root, 'target')))).rejects.toThrow('another Positron window');
		});

		it('accepts the folder the window itself already shows', async () => {
			await expect(resolveCanvasFolder(window, [window], URI.file(root))).resolves.toEqual(window.openedWorkspace);
		});

		it.each<[string, Partial<ICodeWindow>]>([
			['not loaded', { isReady: false }],
			['remote', { remoteAuthority: 'ssh-remote+host' }],
			['multi-root', { openedWorkspace: { id: 'w', configPath: URI.file('/w.code-workspace') } satisfies IWorkspaceIdentifier }],
			['empty', { openedWorkspace: undefined }],
		])('rejects when the window is %s', async (_name, overrides) => {
			const unsuitable = await createWindow(3, root, overrides);
			await expect(resolveCanvasFolder(unsuitable, [unsuitable], URI.file(join(root, 'target')))).rejects.toThrow('single-folder window');
		});

		it('rejects a missing window', async () => {
			await expect(resolveCanvasFolder(undefined, [], URI.file(root))).rejects.toThrow('single-folder window');
		});
	});

	describe('enterCanvasFolder', () => {
		it('commits the folder identity and a fresh backup home without focusing the window', async () => {
			const result = await enterCanvasFolder(window, [window], backups, URI.file(join(root, 'target')));
			const canonical = URI.file(await fs.realpath(join(root, 'target')));
			expect(result.workspace).toEqual(getSingleFolderWorkspaceIdentifier(canonical, await fs.stat(canonical.fsPath)));
			expect({ workspace: config.workspace, backupPath: config.backupPath }).toEqual({ workspace: result.workspace, backupPath: '/backup/new' });
			expect(registerFolderBackup).toHaveBeenCalledWith({ folderUri: canonical, remoteAuthority: undefined });
			expect(window.focus).not.toHaveBeenCalled();
		});

		it('keeps extension development windows without a backup home', async () => {
			config.extensionDevelopmentPath = ['/ext'];
			const result = await enterCanvasFolder(window, [window], backups, URI.file(join(root, 'target')));
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
