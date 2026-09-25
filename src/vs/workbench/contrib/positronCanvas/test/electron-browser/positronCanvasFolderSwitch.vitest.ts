/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { IWorkspace, IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService, IWorkspaceTrustUriInfo } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderResolution } from '../../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { IRecentlyOpened, IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { CanvasFolderSwitcher, GET_CANVAS_FOLDERS_COMMAND_ID, SWITCH_CANVAS_FOLDER_COMMAND_ID } from '../../electron-browser/positronCanvasFolderSwitch.js';
import { IPositronCanvasService } from '../../electron-browser/positronCanvasService.js';

const SOURCE = URI.file('/projects/gamma');
const TARGET = URI.file('/projects/delta');
const TARGET_RESOLUTION: ICanvasFolderResolution = { workspace: { id: 'delta', uri: TARGET }, physicalUri: TARGET };

/** A runtime session named `name` in `state`, with the id `${name}-id`. */
function createSession(name: string, state: RuntimeState = RuntimeState.Idle): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		sessionId: `${name}-id`,
		dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: name }),
		getRuntimeState: () => state
	});
}

interface IWorldOptions {
	aiEnabled?: boolean;
	canvasActive?: boolean;
	remoteAuthority?: string;
	workbenchState?: WorkbenchState;
	hasDirty?: boolean;
	sessions?: ILanguageRuntimeSession[];
	/** URIs the trust service reports as untrusted. */
	untrusted?: URI[];
	/** The main process's answer to `resolveCanvasFolder`; the target by default. */
	resolve?: () => Promise<ICanvasFolderResolution>;
	/** The main process's answer to `openCanvasFolder`; accepted by default. */
	open?: () => Promise<void>;
	deleteSession?: (sessionId: string) => Promise<boolean>;
	willShutdown?: boolean;
}

describe('CanvasFolderSwitcher', () => {
	const ctx = createTestContainer().build();

	/**
	 * A Canvas window on `gamma` with every collaborator recording into
	 * `calls`, so a refusal is checked as "nothing was called" and a run as
	 * the exact order of what was.
	 */
	function build(options: IWorldOptions = {}) {
		const calls: string[] = [];
		const state = { canvasActive: options.canvasActive ?? true, presenting: true, willShutdown: options.willShutdown ?? false };
		const sessions = [...(options.sessions ?? [createSession('R')])];
		const untrusted = options.untrusted ?? [];

		const channelCall = vi.fn().mockImplementation(async (command: string, args: unknown[]) => {
			const folder = args[1] as URI;
			switch (command) {
				case 'resolveCanvasFolder':
					return options.resolve ? options.resolve() : TARGET_RESOLUTION;
				case 'openCanvasFolder':
					calls.push(`main.openCanvasFolder(${folder.fsPath})`);
					return options.open ? options.open() : undefined;
				default:
					throw new Error(`unexpected channel call ${command}`);
			}
		});

		ctx.instantiationService.stub(IPositronCanvasService, stubInterface<IPositronCanvasService>({
			get isActive() { return state.canvasActive; },
			openFolderWithLoadingPresentation: async (open: (stillPresenting: () => boolean) => Promise<void>) => {
				calls.push('canvas.present');
				await open(() => state.presenting);
				calls.push('canvas.accepted');
			}
		}));
		ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<IWorkspaceContextService>({
			getWorkbenchState: () => options.workbenchState ?? WorkbenchState.FOLDER,
			getWorkspace: () => stubInterface<IWorkspace>({ folders: [{ uri: SOURCE, name: 'gamma', index: 0, toResource: () => SOURCE }] })
		}));
		ctx.instantiationService.stub(INativeWorkbenchEnvironmentService, stubInterface<INativeWorkbenchEnvironmentService>({ remoteAuthority: options.remoteAuthority }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get activeSessions() { return sessions; },
			// A successful deletion leaves the live list, as the real service's does.
			deleteSession: async (sessionId: string) => {
				calls.push(`runtime.delete(${sessionId})`);
				const deleted = options.deleteSession ? await options.deleteSession(sessionId) : true;
				if (deleted) {
					sessions.splice(sessions.findIndex(session => session.sessionId === sessionId), 1);
				}
				return deleted;
			}
		}));
		ctx.instantiationService.stub(IWorkingCopyService, stubInterface<IWorkingCopyService>({ hasDirty: options.hasDirty ?? false }));
		ctx.instantiationService.stub(IWorkspaceTrustManagementService, stubInterface<IWorkspaceTrustManagementService>({
			getUriTrustInfo: async (uri: URI) => stubInterface<IWorkspaceTrustUriInfo>({ uri, trusted: !untrusted.some(u => u.toString() === uri.toString()) })
		}));
		ctx.instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => options.aiEnabled ?? true }));
		ctx.instantiationService.stub(ILifecycleService, stubInterface<ILifecycleService>({ get willShutdown() { return state.willShutdown; } }));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ windowId: 1 }));
		ctx.instantiationService.stub(IMainProcessService, stubInterface<IMainProcessService>({
			getChannel: () => stubInterface<IChannel>({ call: channelCall })
		}));

		const switcher = ctx.instantiationService.createInstance(CanvasFolderSwitcher);
		return { switcher, calls, state, channelCall, sessions };
	}

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
			['a runtime session is still starting', { sessions: [createSession('R', RuntimeState.Starting)] }, 'Wait for it to settle'],
			['a runtime session is restarting', { sessions: [createSession('Python'), createSession('R', RuntimeState.Restarting)] }, 'The R session is restarting'],
			['the main process refuses the folder', { resolve: () => Promise.reject(new Error('The folder /projects/delta does not exist.')) }, 'does not exist'],
		] satisfies [string, IWorldOptions, string][])('when %s', async (_name, options, message) => {
			const { switcher, calls } = build(options);
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow(message);
			expect(calls).toEqual([]);
		});

		it('when the path is not absolute', async () => {
			const { switcher, calls, channelCall } = build();
			await expect(switcher.switchFolder('projects/delta')).rejects.toThrow('absolute');
			expect({ calls, mainCalls: channelCall.mock.calls.length }).toEqual({ calls: [], mainCalls: 0 });
		});
	});

	it('does nothing when the destination is the current folder', async () => {
		const { switcher, calls } = build({ resolve: async () => ({ workspace: { id: 'gamma', uri: SOURCE }, physicalUri: SOURCE }) });
		await switcher.switchFolder(SOURCE.fsPath);
		expect(calls).toEqual([]);
	});

	it('shuts the sessions down behind the presentation, rechecks, then asks the main process to load the folder', async () => {
		const { switcher, calls, channelCall } = build({ sessions: [createSession('R'), createSession('Python')] });
		await switcher.switchFolder(TARGET.fsPath);
		expect(calls).toEqual([
			'canvas.present',
			'runtime.delete(R-id)',
			'runtime.delete(Python-id)',
			'main.openCanvasFolder(/projects/delta)',
			'canvas.accepted',
		]);
		// Resolved once in preflight and once more right before the load.
		expect(channelCall.mock.calls.map(call => call[0])).toEqual(['resolveCanvasFolder', 'resolveCanvasFolder', 'openCanvasFolder']);
	});

	describe('when preparation fails behind the presentation', () => {
		it('a declined runtime shutdown stops before the load', async () => {
			const { switcher, calls } = build({ deleteSession: async () => false });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('Shutting down the R session was cancelled.');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)']);
		});

		it('a runtime shutdown that rejects is reported in words, not the raw error', async () => {
			const { switcher, calls } = build({ deleteSession: () => Promise.reject(new Error('Cannot delete session because it is disconnected.')) });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('The R session could not be shut down.');
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.not.toThrow('Cannot delete');
			expect(calls.filter(call => call.startsWith('main.'))).toEqual([]);
		});

		it('a runtime shutdown that never settles is refused after a bounded wait', async () => {
			vi.useFakeTimers();
			try {
				const { switcher, calls } = build({ deleteSession: () => new Promise<boolean>(() => { }) });
				const result = expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('The R session did not shut down in time. Try again.');
				await vi.advanceTimersByTimeAsync(10_000);
				await result;
				expect(calls.filter(call => call.startsWith('main.'))).toEqual([]);
			} finally {
				vi.useRealTimers();
			}
		});

		it('a session that turned busy after an earlier shutdown is refused instead of prompted for', async () => {
			let state = RuntimeState.Idle;
			const late = stubInterface<ILanguageRuntimeSession>({ sessionId: 'R-id', dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'R' }), getRuntimeState: () => state });
			const { switcher, calls } = build({ sessions: [createSession('Python'), late], deleteSession: async () => { state = RuntimeState.Busy; return true; } });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('The R session is busy.');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(Python-id)']);
		});

		it('a Canvas gone before the first shutdown stops before any session is touched', async () => {
			const { switcher, calls, state } = build();
			state.presenting = false;
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('closed while switching');
			expect(calls).toEqual(['canvas.present']);
		});

		it('a session that arrives while another is shutting down is shut down too', async () => {
			const { switcher, calls, sessions } = build({ deleteSession: async sessionId => { if (sessionId === 'R-id') { sessions.push(createSession('Julia')); } return true; } });
			await switcher.switchFolder(TARGET.fsPath);
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)', 'runtime.delete(Julia-id)', 'main.openCanvasFolder(/projects/delta)', 'canvas.accepted']);
		});

		it('sessions that keep arriving are refused after two passes, before the load', async () => {
			let arrivals = 0;
			const { switcher, calls, sessions } = build({ deleteSession: async () => { sessions.push(createSession(`New${++arrivals}`)); return true; } });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('The New2 session started while switching folders');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)', 'runtime.delete(New1-id)']);
		});

		it('a session that arrives during the final checks is refused before the load', async () => {
			let resolves = 0;
			const world = build({ resolve: async () => { if (++resolves === 2) { world.sessions.push(createSession('Julia')); } return TARGET_RESOLUTION; } });
			await expect(world.switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('The Julia session started while switching folders');
			expect(world.calls).toEqual(['canvas.present', 'runtime.delete(R-id)']);
		});

		it('a shutdown that begins during preparation stops before the load', async () => {
			const { switcher, calls, state } = build({ deleteSession: async () => { state.willShutdown = true; return true; } });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('shutting down');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)']);
		});

		it('a Canvas closed during preparation stops before the load', async () => {
			const { switcher, calls, state } = build({ deleteSession: async () => { state.presenting = false; state.canvasActive = false; return true; } });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('closed while switching');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)']);
		});

		it('an exit followed by an immediate re-entry during preparation stops before the load', async () => {
			// Canvas is active again, but it is not the Canvas this request
			// started from; only the service's ownership predicate can tell.
			const { switcher, calls, state } = build({ deleteSession: async () => { state.presenting = false; state.canvasActive = true; return true; } });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('closed while switching');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)']);
		});

		it('an unload veto from the main process is passed on', async () => {
			const { switcher, calls } = build({ open: () => Promise.reject(new Error('Positron could not leave the current folder.')) });
			await expect(switcher.switchFolder(TARGET.fsPath)).rejects.toThrow('could not leave the current folder');
			expect(calls).toEqual(['canvas.present', 'runtime.delete(R-id)', 'main.openCanvasFolder(/projects/delta)']);
		});
	});

	describe('commands', () => {
		const switchHandler = () => CommandsRegistry.getCommand(SWITCH_CANVAS_FOLDER_COMMAND_ID)!.handler;

		it('rejects a missing or non-string path in words', () => {
			const { calls } = build();
			for (const argument of [undefined, 42, { path: TARGET.fsPath }]) {
				expect(() => ctx.instantiationService.invokeFunction(accessor => switchHandler()(accessor, argument))).toThrow('Canvas needs a folder path');
			}
			expect(calls).toEqual([]);
		});

		it('refuses a second request while the first is in flight, then accepts a new one', async () => {
			const gate = new DeferredPromise<void>();
			const { calls } = build({ open: () => gate.p });
			const first = ctx.instantiationService.invokeFunction(accessor => switchHandler()(accessor, TARGET.fsPath));
			await vi.waitFor(() => expect(calls).toContain('main.openCanvasFolder(/projects/delta)'));

			expect(() => ctx.instantiationService.invokeFunction(accessor => switchHandler()(accessor, TARGET.fsPath))).toThrow('already switching');

			await gate.complete();
			await first;
			await ctx.instantiationService.invokeFunction(accessor => switchHandler()(accessor, TARGET.fsPath));
			expect(calls.filter(call => call === 'canvas.accepted')).toHaveLength(2);
		});

		it('lists the local recent folders most recent first, leaving files, workspaces and remote folders out', async () => {
			build();
			ctx.instantiationService.stub(IWorkspacesService, stubInterface<IWorkspacesService>({
				getRecentlyOpened: async () => stubInterface<IRecentlyOpened>({
					workspaces: [
						{ folderUri: URI.file('/projects/delta') },
						{ workspace: { id: 'ws', configPath: URI.file('/projects/multi.code-workspace') } },
						{ folderUri: URI.parse('vscode-remote://ssh-remote+host/projects/remote') },
						{ folderUri: URI.file('/projects/gamma') },
					],
					files: [{ fileUri: URI.file('/projects/notes.txt') }]
				})
			}));

			const folders = await ctx.instantiationService.invokeFunction(accessor => CommandsRegistry.getCommand(GET_CANVAS_FOLDERS_COMMAND_ID)!.handler(accessor));

			expect(folders).toEqual(['/projects/delta', '/projects/gamma']);
		});
	});
});
