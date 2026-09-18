/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../../workspace/common/workspace.js';
import { assertCanvasFolderOpenTarget, ICanvasFolderOpenPath, ICanvasFolderOpenWindow, loadCanvasFolderWindow, rejectCanvasFolderOpenCollision } from '../../electron-main/positronCanvasFolderOpen.js';
import { IOpenConfiguration, OpenContext } from '../../electron-main/windows.js';

suite('Canvas folder open routing', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const source: ISingleFolderWorkspaceIdentifier = { id: 'source-id', uri: URI.file('/projects/alpha') };
	const destination: ISingleFolderWorkspaceIdentifier = { id: 'dest-id', uri: URI.file('/projects/beta') };
	const other: ISingleFolderWorkspaceIdentifier = { id: 'other-id', uri: URI.file('/projects/gamma') };
	const workspaceFile: IWorkspaceIdentifier = { id: 'ws-id', configPath: URI.file('/projects/beta.code-workspace') };

	function window(id: number, overrides: Partial<ICanvasFolderOpenWindow> = {}): ICanvasFolderOpenWindow {
		return { id, isReady: true, remoteAuthority: undefined, openedWorkspace: source, ...overrides };
	}

	/** A Canvas folder open request into window 1, as `openCanvasFolder` builds it. */
	function canvasRequest(overrides: Partial<IOpenConfiguration> = {}): IOpenConfiguration {
		return { context: OpenContext.API, contextWindowId: 1, cli: { _: [] }, urisToOpen: [{ folderUri: destination.uri }], forceReuseWindow: true, positronCanvasFolderOpen: destination, ...overrides };
	}

	/** The same request without the option: an ordinary API open. */
	function ordinaryRequest(): IOpenConfiguration {
		return canvasRequest({ positronCanvasFolderOpen: undefined });
	}

	suite('after path resolution', () => {

		test('accepts exactly the requested folder into a ready single-folder source window', () => {
			assertCanvasFolderOpenTarget(canvasRequest(), [{ workspace: destination }], window(1));
		});

		const rejectedPaths: [string, readonly ICanvasFolderOpenPath[]][] = [
			['the folder vanished (no path resolved)', []],
			['a different folder resolved', [{ workspace: other }]],
			['the same uri resolved with another identity', [{ workspace: { id: 'stale-id', uri: destination.uri } }]],
			['a workspace file resolved', [{ workspace: workspaceFile }]],
			['a file resolved', [{ fileUri: destination.uri }]],
			['more than one path resolved', [{ workspace: destination }, { workspace: other }]],
		];
		for (const [name, paths] of rejectedPaths) {
			test(`rejects when ${name}`, () => {
				assert.throws(() => assertCanvasFolderOpenTarget(canvasRequest(), paths, window(1)), /changed or went away/);
			});
		}

		const goneWindows: [string, ICanvasFolderOpenWindow | undefined][] = [
			['closed', undefined],
			['not the requested window', window(2)],
			['not ready', window(1, { isReady: false })],
			['remote', window(1, { remoteAuthority: 'ssh-remote+host' })],
			['multi-root', window(1, { openedWorkspace: workspaceFile })],
			['empty', window(1, { openedWorkspace: undefined })],
		];
		for (const [name, contextWindow] of goneWindows) {
			test(`rejects when the source window is ${name}`, () => {
				assert.throws(() => assertCanvasFolderOpenTarget(canvasRequest(), [{ workspace: destination }], contextWindow), /no longer available/);
			});
		}

		test('leaves an ordinary open alone whatever resolved', () => {
			assertCanvasFolderOpenTarget(ordinaryRequest(), [], undefined);
			assertCanvasFolderOpenTarget(ordinaryRequest(), [{ workspace: other }, { fileUri: other.uri }], window(2, { isReady: false }));
		});
	});

	suite('at the existing-window check', () => {

		test('rejects a destination that is already open, before it can be focused', () => {
			assert.throws(() => rejectCanvasFolderOpenCollision(canvasRequest(), [window(2, { openedWorkspace: destination })]), /already open in another Positron window/);
		});

		test('rejects even when the window on the folder is the source itself', () => {
			assert.throws(() => rejectCanvasFolderOpenCollision(canvasRequest(), [window(1, { openedWorkspace: destination })]), /already open/);
		});

		test('passes when no window shows the destination', () => {
			rejectCanvasFolderOpenCollision(canvasRequest(), []);
		});

		test('leaves an ordinary open alone', () => {
			rejectCanvasFolderOpenCollision(ordinaryRequest(), [window(2, { openedWorkspace: destination })]);
		});
	});

	suite('loading the window', () => {

		function recorder() {
			const calls: string[] = [];
			return {
				calls,
				unload: (veto: boolean) => async () => { calls.push('unload'); return veto; },
				load: async () => { calls.push('load'); },
				recover: () => { calls.push('recover'); },
				alive: () => true,
			};
		}

		test('awaits the unload and loads only once it was accepted', async () => {
			const { calls, load, recover, alive } = recorder();
			const unloadAnswer = new DeferredPromise<boolean>();
			const loading = loadCanvasFolderWindow(window(1), 1, () => { calls.push('unload'); return unloadAnswer.p; }, load, recover, alive);

			// Pending unload: nothing loads, the promise stays open.
			let settled = false;
			loading.then(() => { settled = true; }, () => { settled = true; });
			await new Promise(resolve => setTimeout(resolve, 0));
			assert.deepStrictEqual({ calls, settled }, { calls: ['unload'], settled: false });

			unloadAnswer.complete(false);
			await loading;
			assert.deepStrictEqual(calls, ['unload', 'load']);
		});

		test('a veto rejects with a presentable message and never loads', async () => {
			const { calls, unload, load, recover, alive } = recorder();
			await assert.rejects(loadCanvasFolderWindow(window(1), 1, unload(true), load, recover, alive), /could not leave the current folder/);
			assert.deepStrictEqual(calls, ['unload']);
		});

		test('a window that is not ready needs no unload', async () => {
			const { calls, unload, load, recover, alive } = recorder();
			await loadCanvasFolderWindow(window(1, { isReady: false }), 1, unload(true), load, recover, alive);
			assert.deepStrictEqual(calls, ['load']);
		});

		test('a load that fails after the accepted unload reloads the window into its current folder and still rejects', async () => {
			const { calls, unload, recover, alive } = recorder();
			await assert.rejects(loadCanvasFolderWindow(window(1), 1, unload(false), () => { calls.push('load'); return Promise.reject(new Error('profile store unavailable')); }, recover, alive), /profile store unavailable/);
			assert.deepStrictEqual(calls, ['unload', 'load', 'recover']);
		});

		test('a load that fails with no unload behind it has nothing to recover', async () => {
			const { calls, unload, recover, alive } = recorder();
			await assert.rejects(loadCanvasFolderWindow(window(1, { isReady: false }), 1, unload(false), () => { calls.push('load'); return Promise.reject(new Error('backup home unavailable')); }, recover, alive), /backup home unavailable/);
			assert.deepStrictEqual(calls, ['load']);
		});

		test('a quit requested before the unload skips the load once the shared unload resolves', async () => {
			const { calls, unload, load, recover } = recorder();
			await loadCanvasFolderWindow(window(1), 1, unload(false), load, recover, () => false);
			assert.deepStrictEqual(calls, ['unload']);
		});

		test('a quit or close arriving during the pending unload skips the load', async () => {
			const { calls, load, recover } = recorder();
			const unloadAnswer = new DeferredPromise<boolean>();
			let alive = true;
			const loading = loadCanvasFolderWindow(window(1), 1, () => { calls.push('unload'); return unloadAnswer.p; }, load, recover, () => alive);
			// The user quits while the renderer is still shutting down; main
			// coalesces that quit onto this unload.
			alive = false;
			unloadAnswer.complete(false);
			await loading;
			assert.deepStrictEqual(calls, ['unload']);
		});

		test('propagates an unload that fails', async () => {
			const { calls, load, recover, alive } = recorder();
			await assert.rejects(loadCanvasFolderWindow(window(1), 1, () => Promise.reject(new Error('renderer gone')), load, recover, alive), /renderer gone/);
			assert.deepStrictEqual(calls, []);
		});

		test('rejects before unloading when the ordinary path fell back to another window', async () => {
			const { calls, unload, load, recover, alive } = recorder();
			await assert.rejects(loadCanvasFolderWindow(window(7), 1, unload(false), load, recover, alive), /no longer available/);
			await assert.rejects(loadCanvasFolderWindow(undefined, 1, unload(false), load, recover, alive), /no longer available/);
			await assert.rejects(loadCanvasFolderWindow(window(1), undefined, unload(false), load, recover, alive), /no longer available/);
			assert.deepStrictEqual(calls, []);
		});
	});
});
