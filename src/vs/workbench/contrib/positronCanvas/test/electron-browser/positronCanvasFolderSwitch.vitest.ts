/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { ICanvasFolderResult } from '../../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { IRecentlyOpened, IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorPart } from '../../../../browser/parts/editor/editorPart.js';
import { isStoredEditorLayoutHeld } from '../../../../browser/positronEditorPartsLayout.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ICloseEditorsFilter } from '../../../../services/editor/common/editorGroupsService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { GET_CANVAS_FOLDERS_COMMAND_ID, SWITCH_CANVAS_FOLDER_COMMAND_ID } from '../../electron-browser/positronCanvasFolderSwitch.js';
import { createEditor, createLiveGroup, createSession, IPresentOptions, ISwitcherWorldOptions, presentCanvas, SOURCE, switcherWorld, TARGET, TARGET_RESOLUTION } from '../vitest/canvasSwitchTestWorld.js';

describe('CanvasFolderSwitcher', () => {
	const ctx = createTestContainer().build();

	/**
	 * A Canvas window presenting `gamma` over a stubbed Canvas service, every
	 * collaborator recording into `calls`; see the shared world's options.
	 */
	const build = (options: ISwitcherWorldOptions = {}) => switcherWorld(ctx, options);

	/** Lets queued microtasks run without advancing fake timers. */
	const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	describe('refuses before anything changes', () => {
		it.each([
			['AI features are disabled', { aiEnabled: false }, 'AI features are disabled'],
			['Canvas is not presenting', { canvasActive: false }, 'not open in its own window'],
			['the window is remote', { remoteAuthority: 'ssh-remote+host' }, 'single-folder workspace'],
			['the workspace is multi-root', { workbenchState: WorkbenchState.WORKSPACE }, 'single-folder workspace'],
			['the destination is not trusted', { untrusted: [TARGET] }, 'not trusted'],
			['the folder behind a trusted alias is not trusted', { resolve: async () => ({ workspace: { id: 'link', uri: URI.file('/trusted/link') }, physicalUri: URI.file('/untrusted/delta') }), untrusted: [URI.file('/untrusted/delta')] }, 'not trusted'],
			['there are unsaved changes', { hasDirty: true }, 'unsaved changes'],
			['a runtime session is busy', { sessions: [createSession('R', RuntimeState.Busy)] }, 'session is busy'],
			['the main process refuses the folder', { resolve: () => Promise.reject(new Error('The folder /projects/delta does not exist.')) }, 'does not exist'],
		] satisfies [string, ISwitcherWorldOptions, string][])('when %s', async (_name, options, message) => {
			const { switcher, calls, curtain } = build(options);
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow(message);
			expect({ calls, curtain: curtain() }).toEqual({ calls: [], curtain: null });
		});

		it('when the path is not absolute', async () => {
			const { switcher, calls } = build();
			await expect(switcher.switchFolder('projects/delta')).rejects.toThrow('absolute');
			expect(calls).toEqual([]);
		});
	});

	it('does nothing when the destination is the current folder', async () => {
		const { switcher, calls } = build({ resolve: async () => ({ workspace: { id: 'gamma', uri: SOURCE }, physicalUri: SOURCE }) });
		await switcher.switchFolder(SOURCE.fsPath);
		expect(calls).toEqual([]);
	});

	it('runs the workspace half inside the Canvas rebuild: hosts down, identity, storage under the layout hold, editors, backups, hosts up', async () => {
		const { switcher, calls, curtain, mainEditors } = build();
		await switcher.switchFolder(TARGET.fsPath);
		expect(calls).toMatchInlineSnapshot(`
			[
			  "canvas.rebuild",
			  "runtime.delete(R-id)",
			  "extensions.stop",
			  "main.enterCanvasFolder(/projects/delta)",
			  "workspace.initialize(/projects/delta)",
			  "storage.switch(/projects/delta) held=true",
			  "backup.rehome(vscode-userdata:/backups/delta)",
			  "main.closeEditors(a.txt,b.txt)",
			  "recents.add",
			  "extensions.start",
			  "canvas.restore",
			]
		`);
		expect({ curtain: curtain(), held: isStoredEditorLayoutHeld(), mainEditors: mainEditors.length }).toEqual({ curtain: null, held: false, mainEditors: 0 });
	});

	it('applies the destination layout through the main editor part after the source editors are gone', async () => {
		const applyStoredState = vi.fn(async () => { });
		const mainPart = Object.assign(Object.create(EditorPart.prototype) as EditorPart, { windowId: 1, applyStoredState });
		const { switcher, calls } = build({ mainPart });
		applyStoredState.mockImplementation(async () => { calls.push('main.applyStoredState'); });

		await switcher.switchFolder(TARGET.fsPath);

		expect(calls.slice(calls.indexOf('main.closeEditors(a.txt,b.txt)'))).toEqual(['main.closeEditors(a.txt,b.txt)', 'main.applyStoredState', 'recents.add', 'extensions.start', 'canvas.restore']);
	});

	describe('source editors', () => {
		it('are closed by the group that held them, so a destination group sharing an input is left alone', async () => {
			const shared = createEditor('shared.txt');
			const detachedGroup = createLiveGroup('detached', 3, [], [shared]);
			const { switcher, calls } = build({ mainEditors: [shared, createEditor('b.txt')], extraGroups: [detachedGroup] });
			// The detached group records into its own list; swap in the shared recorder.
			vi.mocked(detachedGroup.closeEditors).mockImplementation(async (toClose: EditorInput[] | ICloseEditorsFilter) => { calls.push(`detached.closeEditors(${(Array.isArray(toClose) ? toClose : []).map(editor => editor.getName()).join(',')})`); return true; });

			await switcher.switchFolder(TARGET.fsPath);

			expect(calls.filter(call => call.includes('closeEditors'))).toEqual(['main.closeEditors(shared.txt,b.txt)', 'detached.closeEditors(shared.txt)']);
		});

		it('failing to close stops the commit with a presentable message', async () => {
			const { mainGroup, start, curtain, canvasGone } = build();
			vi.mocked(mainGroup.closeEditors).mockResolvedValueOnce(false);
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('could not be closed'));
			expect(outcome()).toBe('pending');
			canvasGone();
			await promise;
		});
	});

	describe('when a step fails', () => {
		it('a declined runtime shutdown stops before the folder changes; the promise waits for Open Positron and then rejects with the cause', async () => {
			const { calls, curtain, click, exit, start } = build({ deleteSession: async () => false });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('Shutting down the R session was cancelled.'));
			expect({ committed: calls.some(call => call.startsWith('main.enterCanvasFolder')), outcome: outcome() }).toEqual({ committed: false, outcome: 'pending' });

			click('Open Positron');
			await promise;
			expect({ outcome: outcome(), exits: exit.mock.calls.length, curtain: curtain(), started: calls.filter(call => call === 'extensions.start') })
				.toEqual({ outcome: 'rejected: Shutting down the R session was cancelled.', exits: 1, curtain: null, started: [] });
		});

		it('a runtime shutdown that rejects is reported in words, not the raw error', async () => {
			const { curtain, start, canvasGone } = build({ deleteSession: () => Promise.reject(new Error('Cannot delete session because it is disconnected.')) });
			const { promise } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('The R session could not be shut down.'));
			expect(curtain()).not.toHaveTextContent('Cannot delete');
			canvasGone();
			await promise;
		});

		it('a session that turned busy after preflight is refused instead of prompted for', async () => {
			let state = RuntimeState.Idle;
			const session = stubInterface<ILanguageRuntimeSession>({ sessionId: 'R-id', dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'R' }), getRuntimeState: () => state });
			const { calls, curtain, start, canvasGone } = build({ sessions: [createSession('Python'), session], deleteSession: async () => { state = RuntimeState.Busy; return true; } });
			const { promise } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('The R session is busy.'));
			expect(calls.filter(call => call.startsWith('runtime.delete'))).toEqual(['runtime.delete(Python-id)']);
			canvasGone();
			await promise;
		});

		it('Retry Canvas resumes from the failed step and restarts the hosts it stopped', async () => {
			let attempts = 0;
			const { calls, curtain, click, exit, start } = build({
				enter: async () => {
					if (attempts++ === 0) {
						throw new Error('The folder /projects/delta does not exist.');
					}
					return { workspace: TARGET_RESOLUTION.workspace, backupPath: undefined };
				}
			});
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('does not exist'));

			click('Retry Canvas');
			await promise;
			// Detach is not repeated; commit runs again from the top.
			expect(calls.filter(call => call === 'extensions.stop' || call === 'canvas.rebuild' || call.startsWith('main.enterCanvasFolder'))).toEqual([
				'canvas.rebuild',
				'extensions.stop',
				'main.enterCanvasFolder(/projects/delta)',
				'canvas.rebuild',
				'main.enterCanvasFolder(/projects/delta)',
			]);
			expect({ outcome: outcome(), exits: exit.mock.calls.length, curtain: curtain() }).toEqual({ outcome: 'resolved', exits: 0, curtain: null });
		});

		it('Open Positron after a main-process refusal restarts extensions and exits', async () => {
			const { calls, click, curtain, start } = build({ enter: () => Promise.reject(new Error('gone')) });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('gone'));

			click('Open Positron');
			await promise;
			expect({ tail: calls.slice(-2), outcome: outcome() }).toEqual({ tail: ['extensions.start', 'canvas.exit'], outcome: 'rejected: gone' });
		});

		it('reloads into the IDE instead of exiting when the renderer stopped matching the committed folder', async () => {
			const { calls, curtain, click, reloadIntoIde, exit, start, canvasGone } = build({ switchStorage: () => Promise.reject(new Error('storage locked')) });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('storage locked'));
			expect(isStoredEditorLayoutHeld()).toBe(false);

			click('Open Positron');
			await vi.waitFor(() => expect(reloadIntoIde).toHaveBeenCalled());
			await settle();
			// The renderer is going away; nothing else runs.
			expect({ exits: exit.mock.calls.length, outcome: outcome(), tail: calls.slice(-1) }).toEqual({ exits: 0, outcome: 'pending', tail: ['canvas.reloadIntoIde'] });
			canvasGone();
			await promise;
		});

		it('a refused reload brings the failure card back with the lock still held', async () => {
			const { curtain, click, buttons, start, canvasGone } = build({ switchStorage: () => Promise.reject(new Error('storage locked')), reloadAccepted: false });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('storage locked'));

			click('Open Positron');
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('did not reload'));
			expect({ buttons: buttons(), outcome: outcome() }).toEqual({ buttons: ['Retry Canvas', 'Open Positron'], outcome: 'pending' });
			canvasGone();
			await promise;
		});

		it('a Canvas half that fails after the workspace half is retried without replaying the workspace steps', async () => {
			const { calls, curtain, click, start } = build({ restoreFailures: ['Canvas did not finish starting in the new workspace.'] });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('did not finish starting'));

			click('Retry Canvas');
			await promise;
			expect({ outcome: outcome(), rebuilds: calls.filter(call => call === 'canvas.rebuild').length, commits: calls.filter(call => call.startsWith('main.enter')).length, hostStarts: calls.filter(call => call === 'extensions.start').length })
				.toEqual({ outcome: 'resolved', rebuilds: 2, commits: 1, hostStarts: 1 });
		});

		it('Open Positron failing leaves an actionable card each time', async () => {
			const { curtain, click, buttons, exit, start } = build({ enter: () => Promise.reject(new Error('gone')) });
			exit.mockRejectedValueOnce(new Error('exit failed once')).mockRejectedValueOnce(new Error('exit failed twice'));
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('gone'));

			click('Open Positron');
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('exit failed once'));
			click('Open Positron');
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('exit failed twice'));
			expect(buttons()).toEqual(['Retry Canvas', 'Open Positron']);

			click('Open Positron');
			await promise;
			expect(outcome()).toBe('rejected: exit failed twice');
		});
	});

	describe('when Canvas goes away', () => {
		it('on an idle failure card: hosts come back, the curtain comes down, the promise rejects as cancelled', async () => {
			const { calls, curtain, canvasGone, start } = build({ enter: () => Promise.reject(new Error('gone')) });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('gone'));

			canvasGone();
			await promise;
			expect({ outcome: outcome(), curtain: curtain(), tail: calls.slice(-1) }).toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', curtain: null, tail: ['extensions.start'] });
		});

		it('during detach: the workspace half stops before the commit and the hosts come back', async () => {
			const deleting = new DeferredPromise<boolean>();
			const { calls, cancel, start } = build({ deleteSession: () => deleting.p });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(calls).toContain('runtime.delete(R-id)'));

			cancel();
			await deleting.complete(true);
			await promise;
			expect({ outcome: outcome(), committed: calls.some(call => call.startsWith('main.enter')), tail: calls.slice(-2) })
				.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', committed: false, tail: ['extensions.stop', 'extensions.start'] });
		});

		it('while the main process commits: the renderer finishes matching it, hosts come back, nothing reloads', async () => {
			const entering = new DeferredPromise<ICanvasFolderResult>();
			const { calls, cancel, reloadIntoIde, start } = build({ enter: () => entering.p });
			const { promise, outcome } = start();
			await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

			cancel();
			await entering.complete({ workspace: TARGET_RESOLUTION.workspace, backupPath: undefined });
			await promise;
			expect({ outcome: outcome(), reloads: reloadIntoIde.mock.calls.length, tail: calls.slice(-3) })
				.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', reloads: 0, tail: ['main.closeEditors(a.txt,b.txt)', 'recents.add', 'extensions.start'] });
		});

		it('while the main process commits and the renderer then cannot follow: reload, so the main process wins', async () => {
			const entering = new DeferredPromise<ICanvasFolderResult>();
			const { calls, cancel, reloadIntoIde, start } = build({ enter: () => entering.p, initialize: () => Promise.reject(new Error('init failed')) });
			const { promise } = start();
			await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

			cancel();
			await entering.complete({ workspace: TARGET_RESOLUTION.workspace, backupPath: undefined });
			await promise;
			expect(reloadIntoIde).toHaveBeenCalledTimes(1);
		});

		it('during shutdown: nothing restarts and nothing reloads', async () => {
			const entering = new DeferredPromise<ICanvasFolderResult>();
			const { calls, cancel, reloadIntoIde, start } = build({ enter: () => entering.p, initialize: () => Promise.reject(new Error('init failed')), willShutdown: true });
			const { promise } = start();
			await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

			cancel();
			await entering.complete({ workspace: TARGET_RESOLUTION.workspace, backupPath: undefined });
			await promise;
			expect({ reloads: reloadIntoIde.mock.calls.length, started: calls.filter(call => call === 'extensions.start') }).toEqual({ reloads: 0, started: [] });
		});
	});

	describe('commands', () => {
		/** Command handlers are typed as returning void; these return promises. */
		const handler = (id: string) => CommandsRegistry.getCommand(id)!.handler as (accessor: ServicesAccessor, ...args: unknown[]) => unknown;

		it('switchCanvasFolder refuses a second switch while one holds the window, until it settles', async () => {
			let attempts = 0;
			const { curtain, click } = build({
				enter: async () => {
					if (attempts++ === 0) {
						throw new Error('gone');
					}
					return { workspace: TARGET_RESOLUTION.workspace, backupPath: undefined };
				}
			});
			// Take the transaction through the registered handler so the
			// in-flight guard is the one under test.
			const first = ctx.instantiationService.invokeFunction(accessor => handler(SWITCH_CANVAS_FOLDER_COMMAND_ID)(accessor, TARGET.fsPath) as Promise<void>).catch((error: Error) => error.message);
			await vi.waitFor(() => expect(curtain()).toHaveTextContent('gone'));
			expect(() => ctx.instantiationService.invokeFunction(accessor => handler(SWITCH_CANVAS_FOLDER_COMMAND_ID)(accessor, TARGET.fsPath))).toThrow('already switching');

			click('Open Positron');
			expect(await first).toBe('gone');
			// Settled: the guard lets a later transaction through (this one
			// runs the stubbed happy path to completion).
			const second = ctx.instantiationService.invokeFunction(accessor => handler(SWITCH_CANVAS_FOLDER_COMMAND_ID)(accessor, TARGET.fsPath) as Promise<void>);
			await expect(second).resolves.toBeUndefined();
		});

		it('getCanvasFolders lists local folders only, most recent first', async () => {
			build();
			ctx.instantiationService.stub(IWorkspacesService, stubInterface<IWorkspacesService>({
				getRecentlyOpened: async () => stubInterface<IRecentlyOpened>({
					workspaces: [
						{ folderUri: URI.file('/projects/newest') },
						{ workspace: { id: 'ws', configPath: URI.file('/projects/multi.code-workspace') } },
						{ folderUri: URI.parse('vscode-remote://ssh-remote+host/home/user/remote') },
						{ folderUri: URI.file('/projects/oldest') },
					],
					files: [],
				}),
			}));

			const folders = await ctx.instantiationService.invokeFunction(accessor => handler(GET_CANVAS_FOLDERS_COMMAND_ID)(accessor) as Promise<string[]>);

			expect(folders).toEqual([URI.file('/projects/newest').fsPath, URI.file('/projects/oldest').fsPath]);
		});
	});

	describe('with the real Canvas service', () => {
		/**
		 * Both halves for real over the stubbed workbench: the contract each
		 * half's tests otherwise stub. The IDE window holds `a.txt`.
		 */
		const present = (options: IPresentOptions = {}) => presentCanvas(ctx, { mainEditors: [createEditor('a.txt')], ...options });

		it('switches folders in the Canvas window: placeholder, workspace half, fresh panel, flag on the destination', async () => {
			const { service, start, calls, names, curtain } = await present();

			const { promise, outcome } = start();
			await promise;

			// What only the composition shows: the placeholder holds the window
			// before the source flag goes, and the destination flag lands only
			// after the assistant produced the new panel. Each half's own order
			// is pinned above and in the service's tests.
			const at = (call: string) => calls.indexOf(call);
			expect({
				outcome: outcome(),
				names: names(),
				active: service.isActive,
				curtain: curtain(),
				placeholderBeforeFlagCleared: at('canvas.open(Canvas)') < at('storage.remove'),
				flagStoredAfterEnsure: at('assistant.ensure') < at('storage.store'),
			}).toEqual({ outcome: 'resolved', names: { canvas: ['Panel 2'], main: [] }, active: true, curtain: null, placeholderBeforeFlagCleared: true, flagStoredAfterEnsure: true });
		});

		it('an exit during the main-process commit waits for the renderer to match it, then hands back the IDE', async () => {
			const entering = new DeferredPromise<ICanvasFolderResult>();
			const { service, start, calls, names } = await present({ enter: () => entering.p });

			const { promise, outcome } = start();
			await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

			const exiting = service.exit();
			await settle();
			expect({ merged: calls.includes('merge'), released: calls.includes('main.release') }).toEqual({ merged: false, released: false });

			await entering.complete({ workspace: TARGET_RESOLUTION.workspace, backupPath: undefined });
			await promise;
			expect(await exiting).toBe(true);

			expect(calls.slice(calls.indexOf('workspace.initialize(/projects/delta)'))).toEqual([
				'workspace.initialize(/projects/delta)',
				'storage.switch(/projects/delta) held=true',
				'backup.rehome(in-memory)',
				'main.closeEditors(a.txt)',
				'recents.add',
				'extensions.start',
				'storage.remove',
				'window.show',
				'canvas.lock(false)',
				'merge',
				'canvas.close(Canvas)',
				'main.release',
			]);
			expect({ outcome: outcome(), names: names(), active: service.isActive, ensures: calls.filter(call => call === 'assistant.ensure').length })
				.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', names: { canvas: [], main: [] }, active: false, ensures: 0 });
		});

		it('an exit during a main-process commit that fails restarts the hosts and changes nothing else', async () => {
			const entering = new DeferredPromise<ICanvasFolderResult>();
			const { service, start, calls } = await present({ enter: () => entering.p });

			const { promise, outcome } = start();
			await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

			const exiting = service.exit();
			await entering.error(new Error('refused'));
			await promise;
			await exiting;

			expect({ outcome: outcome(), initialized: calls.some(call => call.startsWith('workspace.initialize')), reloaded: calls.includes('host.reload'), started: calls.filter(call => call === 'extensions.start').length })
				.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', initialized: false, reloaded: false, started: 1 });
		});
	});
});
