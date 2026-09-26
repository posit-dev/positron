/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';
import { NativeParsedArgs } from '../../../environment/common/argv.js';
import { INativeWindowConfiguration } from '../../../window/common/window.js';
import { ICodeWindow } from '../../../window/electron-main/window.js';
import { IOpenConfiguration, OpenContext } from '../../../windows/electron-main/windows.js';
import { IWorkspaceIdentifier } from '../../../workspace/common/workspace.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { ICanvasFolderFs, ICanvasFolderOpener, openCanvasFolder, resolveCanvasFolder } from '../../electron-main/positronFolderWorkspace.js';
import { getSingleFolderWorkspaceIdentifier } from '../../node/workspaces.js';

const posixOnly = it.skipIf(process.platform === 'win32');

describe('Canvas folder open (main process)', () => {
	let root: string;
	let target: string;
	let window: ICodeWindow;
	let config: Pick<INativeWindowConfiguration, 'workspace' | 'backupPath' | 'extensionDevelopmentPath'>;

	/** A ready, local, single-folder window on `folder`, with `overrides` applied. */
	async function createWindow(id: number, folder: string, overrides: Partial<ICodeWindow> = {}): Promise<ICodeWindow> {
		const workspace = getSingleFolderWorkspaceIdentifier(URI.file(folder), await fs.stat(folder));
		// Every property the open reads is set: an unset read on a stub throws.
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
		root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'canvas-folder-open-')));
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

	describe('openCanvasFolder', () => {
		/** Process arguments carrying every operand the request must not inherit. */
		const processArgs: NativeParsedArgs = {
			_: ['/somewhere/else'],
			'folder-uri': ['file:///other'],
			'file-uri': ['file:///other/file.txt'],
			wait: true,
			waitMarkerFilePath: '/tmp/wait',
			remote: 'ssh-remote+host',
			'new-window': true,
			'user-data-dir': '/profile',
			'extensions-dir': '/profile/extensions',
			verbose: true
		};

		function createOpener(open: ICanvasFolderOpener['open'] = async () => []): { opener: ICanvasFolderOpener; open: ReturnType<typeof vi.fn>; args: NativeParsedArgs } {
			const args = structuredClone(processArgs);
			const openMock = vi.fn(open);
			return { opener: { args, open: openMock }, open: openMock, args };
		}

		it('opens the resolved folder into the calling window with a fresh --canvas launch and no inherited operands', async () => {
			const { opener, open, args } = createOpener();
			const before = structuredClone(args);

			await openCanvasFolder(window, [window], URI.file(target), opener);

			expect(open).toHaveBeenCalledTimes(1);
			const request: IOpenConfiguration = open.mock.calls[0][0];
			expect({ ...request, cli: undefined }).toEqual({
				context: OpenContext.API,
				contextWindowId: 1,
				urisToOpen: [{ folderUri: (await identityOf(target)).uri }],
				forceReuseWindow: true,
				cli: undefined,
				positronCanvasFolderOpen: await identityOf(target)
			});
			expect(request.cli).toEqual({
				...before,
				_: [],
				'folder-uri': undefined,
				'file-uri': undefined,
				wait: undefined,
				waitMarkerFilePath: undefined,
				chat: undefined,
				remote: undefined,
				diff: undefined,
				merge: undefined,
				add: undefined,
				remove: undefined,
				goto: undefined,
				'new-window': undefined,
				'reuse-window': undefined,
				canvas: true
			});
			// The process arguments are the shared launch record; the request got a copy.
			expect(args).toEqual(before);
			expect(request.cli).not.toBe(args);
		});

		it('hands each request its own argument object', async () => {
			const { opener, open } = createOpener();
			const second = join(root, 'second');
			await fs.mkdir(second);

			await openCanvasFolder(window, [window], URI.file(target), opener);
			await openCanvasFolder(window, [window], URI.file(second), opener);

			const [first, next] = open.mock.calls.map(call => (call[0] as IOpenConfiguration).cli);
			expect(first).not.toBe(next);
			expect([first.canvas, next.canvas]).toEqual([true, true]);
		});

		it('propagates a rejected open', async () => {
			const { opener } = createOpener(() => Promise.reject(new Error('The window declined to unload.')));
			await expect(openCanvasFolder(window, [window], URI.file(target), opener)).rejects.toThrow('declined to unload');
		});

		it.each([
			['the folder is missing', () => URI.file(join(root, 'missing')), 'does not exist'],
			['the folder is the current one', () => URI.file(root), 'already showing'],
		])('never opens when %s', async (_name, folder, message) => {
			const other = await createWindow(2, target);
			const { opener, open } = createOpener();
			await expect(openCanvasFolder(window, [window, other], folder(), opener)).rejects.toThrow(message);
			expect(open).not.toHaveBeenCalled();
		});

		it('never opens a folder another window took in the meantime', async () => {
			const other = await createWindow(2, target);
			const { opener, open } = createOpener();
			await expect(openCanvasFolder(window, [window, other], URI.file(target), opener)).rejects.toThrow('another Positron window');
			expect(open).not.toHaveBeenCalled();
		});

		it('never opens from a window that is no longer suitable', async () => {
			const { opener, open } = createOpener();
			await expect(openCanvasFolder(undefined, [], URI.file(target), opener)).rejects.toThrow('single-folder window');
			expect(open).not.toHaveBeenCalled();
		});
	});
});
