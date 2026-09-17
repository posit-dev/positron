/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DeferredPromise } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { WorkspaceService } from '../../../../services/configuration/browser/configurationService.js';
import { IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ITextEditorService } from '../../../../services/textfile/common/textEditorService.js';
import { IWorkingCopyBackupService } from '../../../../services/workingCopy/common/workingCopyBackup.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_WEBVIEW_VIEW_TYPE } from '../../common/positronCanvasMode.js';
import { CanvasFolderSwitcher } from '../../electron-browser/positronCanvasFolderSwitch.js';
import { IPositronCanvasService } from '../../electron-browser/positronCanvasService.js';

const SOURCE = URI.file('/projects/gamma');
const TARGET = URI.file('/projects/delta');

/** What the main process answers for `/projects/delta`. */
const TARGET_IDENTIFIER: ISingleFolderWorkspaceIdentifier = { id: 'delta', uri: TARGET };

describe('CanvasFolderSwitcher', () => {
	const ctx = createTestContainer().build();

	/** A group whose editor list the switch rearranges, recording into `calls`. */
	function createGroup(name: string, calls: string[], editors: EditorInput[] = []): IEditorGroup {
		const group = stubInterface<IEditorGroup>({
			editors,
			isLocked: true,
			lock: vi.fn(),
			focus: vi.fn(),
			// Read by the real `prepareMoveCopyEditors` when a panel is moved home.
			isSticky: () => false,
			isActive: (editor: EditorInput) => editors.at(-1) === editor,
			getIndexOfEditor: (editor: EditorInput) => editors.indexOf(editor),
			contains: (candidate: EditorInput) => editors.includes(candidate),
			openEditor: vi.fn(async (editor: EditorInput) => {
				calls.push(`${name}.open(${editor.getName()})`);
				if (!editors.includes(editor)) {
					editors.push(editor);
				}
				return undefined;
			}),
			closeEditor: vi.fn(async (editor: EditorInput) => {
				calls.push(`${name}.close(${editor.getName()})`);
				editors.splice(editors.indexOf(editor), 1);
				return true;
			}),
			moveEditors: vi.fn(() => {
				calls.push(`${name}.moveEditors`);
				return true;
			}),
		});
		return group;
	}

	function createCanvasEditor(name: string): WebviewInput {
		const editor = new WebviewInput(
			{ viewType: CANVAS_WEBVIEW_VIEW_TYPE, providedId: CANVAS_WEBVIEW_VIEW_TYPE, name, iconPath: undefined },
			stubInterface<IOverlayWebview>({ state: undefined, dispose: vi.fn() }),
			stubInterface<IThemeService>({ onDidColorThemeChange: Event.None }),
		);
		ctx.disposables.add(editor);
		return editor;
	}

	function createSession(name: string): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({ sessionId: `${name}-id`, dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: name }) });
	}

	/**
	 * A Canvas window presenting `gamma`, with every collaborator recording
	 * the mutations it is asked for into `calls`, in order.
	 */
	function build(options: {
		canvasActive?: boolean;
		remoteAuthority?: string;
		workbenchState?: WorkbenchState;
		aiEnabled?: boolean;
		hasDirty?: boolean;
		trusted?: boolean;
		/** What the main process answers for `resolveCanvasFolder`. */
		resolve?: () => Promise<ISingleFolderWorkspaceIdentifier>;
		/** What the main process answers for `enterCanvasFolder`; called per attempt. */
		enter?: () => Promise<{ workspace: ISingleFolderWorkspaceIdentifier; backupPath: string | undefined }>;
		pick?: URI | undefined;
		sessions?: ILanguageRuntimeSession[];
		deleteSession?: () => Promise<boolean>;
		stopExtensionHosts?: () => Promise<boolean>;
		switchStorage?: () => Promise<void>;
		/** Runs when the assistant is asked to ensure Canvas; defaults to producing a panel in the Canvas group. */
		ensureCanvas?: () => Promise<undefined>;
		/** Where the assistant puts the rebuilt panel. */
		rebuildIn?: 'canvas' | 'main';
	} = {}) {
		const calls: string[] = [];
		const canvasEditor = createCanvasEditor('Canvas');
		const canvasEditors: EditorInput[] = [canvasEditor];
		const mainEditors: EditorInput[] = [];
		const canvasGroup = createGroup('canvas', calls, canvasEditors);
		const mainGroup = createGroup('main', calls, mainEditors);
		const container = document.createElement('div');
		document.body.appendChild(container);
		ctx.disposables.add({ dispose: () => container.remove() });
		const placeholder = stubInterface<EditorInput>({ getName: () => 'placeholder', isDisposed: () => false });

		const exit = vi.fn(async () => { calls.push('canvas.exit'); return true; });
		const reload = vi.fn(async () => { calls.push('host.reload'); });
		const initialize = vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => { calls.push(`workspace.initialize(${workspace.uri.path})`); });
		const storageSwitch = vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => {
			calls.push(`storage.switch(${workspace.uri.path})`);
			await options.switchStorage?.();
		});
		const storageRemove = vi.fn((key: string) => { calls.push(`storage.remove(${key})`); });
		const storageStore = vi.fn((key: string, value: unknown) => { calls.push(`storage.store(${key}=${value})`); });
		const deleteSession = vi.fn(async (sessionId: string) => {
			calls.push(`runtime.delete(${sessionId})`);
			return options.deleteSession ? options.deleteSession() : true;
		});
		const stopExtensionHosts = vi.fn(async () => {
			calls.push('extensions.stop');
			return options.stopExtensionHosts ? options.stopExtensionHosts() : true;
		});
		const startExtensionHosts = vi.fn(async () => { calls.push('extensions.start'); });
		const addRecentlyOpened = vi.fn(async () => { calls.push('recents.add'); });
		const ensureCanvas = vi.fn(async () => {
			calls.push('assistant.ensureCanvas');
			if (options.ensureCanvas) {
				return options.ensureCanvas();
			}
			(options.rebuildIn === 'main' ? mainEditors : canvasEditors).push(createCanvasEditor('Canvas 2'));
			return undefined;
		});
		const channelCall = vi.fn(async (command: string, args: unknown[]) => {
			switch (command) {
				case 'resolveCanvasFolder':
					return options.resolve ? options.resolve() : TARGET_IDENTIFIER;
				case 'enterCanvasFolder':
					calls.push(`main.enterCanvasFolder(${(args[1] as URI).path})`);
					return options.enter ? options.enter() : { workspace: TARGET_IDENTIFIER, backupPath: '/backups/delta' };
				default:
					throw new Error(`unexpected channel call ${command}`);
			}
		});

		ctx.instantiationService.stub(IPositronCanvasService, stubInterface<IPositronCanvasService>({ isActive: options.canvasActive ?? true, activeGroup: canvasGroup, exit }));
		ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<WorkspaceService>({
			getWorkbenchState: () => options.workbenchState ?? WorkbenchState.FOLDER,
			getWorkspace: () => stubInterface<ReturnType<WorkspaceService['getWorkspace']>>({ folders: [stubInterface<ReturnType<WorkspaceService['getWorkspace']>['folders'][number]>({ uri: SOURCE })] }),
			initialize,
		}));
		ctx.instantiationService.stub(INativeWorkbenchEnvironmentService, stubInterface<INativeWorkbenchEnvironmentService>({ remoteAuthority: options.remoteAuthority, userRoamingDataHome: URI.file('/roaming') }));
		ctx.instantiationService.stub(IEditorGroupsService, stubInterface<IEditorGroupsService>({
			groups: [canvasGroup, mainGroup],
			getPart: () => stubInterface<IEditorPart>({ windowId: 1000 }),
		}));
		ctx.instantiationService.stub(ITextEditorService, stubInterface<ITextEditorService>({ createTextEditor: vi.fn().mockReturnValue(placeholder) }));
		ctx.instantiationService.stub(IAuxiliaryWindowService, stubInterface<IAuxiliaryWindowService>({ getWindow: () => stubInterface<IAuxiliaryWindow>({ container }) }));
		ctx.instantiationService.stub(IExtensionService, stubInterface<IExtensionService>({ stopExtensionHosts, startExtensionHosts }));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({ executeCommand: ensureCanvas }));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ activeSessions: options.sessions ?? [createSession('R')], deleteSession }));
		ctx.instantiationService.stub(IStorageService, stubInterface<IStorageService>({ remove: storageRemove, store: storageStore, switch: storageSwitch }));
		ctx.instantiationService.stub(IWorkingCopyBackupService, stubInterface<IWorkingCopyBackupService>({}));
		ctx.instantiationService.stub(IWorkingCopyService, stubInterface<IWorkingCopyService>({ hasDirty: options.hasDirty ?? false }));
		ctx.instantiationService.stub(IWorkspaceTrustManagementService, stubInterface<IWorkspaceTrustManagementService>({ getUriTrustInfo: async (uri: URI) => ({ uri, trusted: options.trusted ?? true }) }));
		ctx.instantiationService.stub(IFileDialogService, stubInterface<IFileDialogService>({ showOpenDialog: async () => options.pick ? [options.pick] : undefined }));
		ctx.instantiationService.stub(IWorkspacesService, stubInterface<IWorkspacesService>({ addRecentlyOpened }));
		ctx.instantiationService.stub(IHostService, stubInterface<IHostService>({ reload }));
		ctx.instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => options.aiEnabled ?? true }));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ windowId: 1 }));
		ctx.instantiationService.stub(IMainProcessService, stubInterface<IMainProcessService>({ getChannel: () => stubInterface<IChannel>({ call: channelCall as IChannel['call'] }) }));

		const switcher = ctx.instantiationService.createInstance(CanvasFolderSwitcher);
		// The curtain is plain DOM built by the Monaco Button widget, not React, and
		// Testing Library queries may only be imported by the vitest infrastructure.
		/** The curtain element while it is up, `null` once it came down. */
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		const curtain = () => container.getElementsByClassName('positron-canvas-startup-curtain').item(0);
		/** Clicks the curtain button labelled `name`; the Button widget renders each as `.monaco-button`. */
		const click = (name: string) => {
			// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
			const button = Array.from(container.getElementsByClassName('monaco-button')).find(element => element.textContent === name);
			if (!button) {
				throw new Error(`no curtain button "${name}"`);
			}
			(button as HTMLElement).click();
		};
		return { switcher, calls, canvasGroup, mainGroup, canvasEditors, container, curtain, click, exit, reload, ensureCanvas, channelCall };
	}

	describe('refuses before anything changes', () => {
		it.each([
			['AI features are disabled', { aiEnabled: false }, 'AI features are disabled'],
			['Canvas is not presenting', { canvasActive: false }, 'not open in its own window'],
			['the window is remote', { remoteAuthority: 'ssh-remote+host' }, 'single-folder workspace'],
			['the workspace is multi-root', { workbenchState: WorkbenchState.WORKSPACE }, 'single-folder workspace'],
			['the destination is not trusted', { trusted: false }, 'not trusted'],
			['there are unsaved changes', { hasDirty: true }, 'unsaved changes'],
			['the main process refuses the folder', { resolve: () => Promise.reject(new Error('The folder /projects/delta does not exist.')) }, 'does not exist'],
		] satisfies [string, Parameters<typeof build>[0], string][])('when %s', async (_name, options, message) => {
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

	describe('does nothing', () => {
		it('when the folder picker is cancelled', async () => {
			const { switcher, calls } = build({ pick: undefined });
			await switcher.switchFolder();
			expect(calls).toEqual([]);
		});

		it('when the destination is the current folder', async () => {
			const { switcher, calls } = build({ resolve: async () => ({ id: 'gamma', uri: SOURCE }) });
			await switcher.switchFolder(SOURCE.fsPath);
			expect(calls).toEqual([]);
		});
	});

	it('detaches, commits and restores in order, moving the Canvas mode flag with the folder', async () => {
		const { switcher, calls, canvasGroup, curtain } = build({ pick: TARGET });
		await switcher.switchFolder();
		expect(calls).toMatchInlineSnapshot(`
			[
			  "canvas.open(placeholder)",
			  "canvas.close(Canvas)",
			  "runtime.delete(R-id)",
			  "extensions.stop",
			  "storage.remove(positron.canvasMode.active)",
			  "main.enterCanvasFolder(/projects/delta)",
			  "workspace.initialize(/projects/delta)",
			  "storage.switch(/projects/delta)",
			  "recents.add",
			  "extensions.start",
			  "assistant.ensureCanvas",
			  "canvas.open(Canvas 2)",
			  "canvas.close(placeholder)",
			  "storage.store(positron.canvasMode.active=true)",
			]
		`);
		expect({ curtain: curtain(), editors: canvasGroup.editors.map(editor => editor.getName()), locked: canvasGroup.lock }).toMatchObject({ curtain: null, editors: ['Canvas 2'] });
		expect(canvasGroup.lock).toHaveBeenNthCalledWith(1, false);
		expect(canvasGroup.lock).toHaveBeenLastCalledWith(true);
	});

	it('brings a panel the assistant built in the IDE window back to the Canvas window', async () => {
		const { switcher, calls, mainGroup } = build({ rebuildIn: 'main' });
		await switcher.switchFolder(TARGET.fsPath);
		expect(calls.slice(calls.indexOf('assistant.ensureCanvas'))).toEqual([
			'assistant.ensureCanvas',
			'main.moveEditors',
			'canvas.open(Canvas 2)',
			'canvas.close(placeholder)',
			'storage.store(positron.canvasMode.active=true)',
		]);
		expect(mainGroup.moveEditors).toHaveBeenCalledTimes(1);
	});

	describe('when a step fails', () => {
		it('stops before the folder changes when a runtime declines to shut down, and Open Positron exits Canvas', async () => {
			const { switcher, calls, curtain, click, exit } = build({ deleteSession: async () => false });
			await switcher.switchFolder(TARGET.fsPath);
			expect(curtain()).toHaveTextContent('Shutting down the R session was cancelled.');
			expect(calls).not.toContain('main.enterCanvasFolder(/projects/delta)');

			click('Open Positron');
			await vi.waitFor(() => expect(exit).toHaveBeenCalled());
			expect(calls.slice(-1)).toEqual(['canvas.exit']);
			expect(curtain()).toBeNull();
		});

		it('restarts stopped extension hosts before handing back the IDE, and Retry Canvas resumes from the failed step', async () => {
			let attempts = 0;
			const { switcher, calls, curtain, click, exit } = build({
				enter: async () => {
					if (attempts++ === 0) {
						throw new Error('The folder /projects/delta does not exist.');
					}
					return { workspace: TARGET_IDENTIFIER, backupPath: undefined };
				}
			});
			await switcher.switchFolder(TARGET.fsPath);
			expect(curtain()).toHaveTextContent('does not exist');
			expect(calls.filter(call => call.startsWith('storage.'))).toEqual(['storage.remove(positron.canvasMode.active)']);

			click('Retry Canvas');
			await vi.waitFor(() => expect(curtain()).toBeNull());
			// Detach is not repeated; commit runs again from the top.
			expect(calls.filter(call => call === 'extensions.stop' || call.startsWith('main.enterCanvasFolder'))).toEqual([
				'extensions.stop',
				'main.enterCanvasFolder(/projects/delta)',
				'main.enterCanvasFolder(/projects/delta)',
			]);
			expect(calls.slice(-1)).toEqual(['storage.store(positron.canvasMode.active=true)']);
			expect(exit).not.toHaveBeenCalled();
		});

		it('Open Positron after a main-process refusal restarts extensions and exits', async () => {
			const { switcher, calls, click, exit } = build({ enter: () => Promise.reject(new Error('gone')) });
			await switcher.switchFolder(TARGET.fsPath);

			click('Open Positron');
			await vi.waitFor(() => expect(exit).toHaveBeenCalled());
			expect(calls.slice(-2)).toEqual(['extensions.start', 'canvas.exit']);
		});

		it('reloads instead of exiting when the renderer stopped matching the committed folder', async () => {
			const { switcher, calls, curtain, click, reload, exit } = build({ switchStorage: () => Promise.reject(new Error('storage locked')) });
			await switcher.switchFolder(TARGET.fsPath);
			expect(curtain()).toHaveTextContent('storage locked');

			click('Open Positron');
			await vi.waitFor(() => expect(reload).toHaveBeenCalled());
			expect(calls.slice(-2)).toEqual(['storage.remove(positron.canvasMode.active)', 'host.reload']);
			expect(exit).not.toHaveBeenCalled();
		});

		it('gives up on a Canvas that never reports ready, and Retry asks the assistant again', async () => {
			vi.useFakeTimers();
			try {
				let stuck = true;
				const { switcher, curtain, click, ensureCanvas, canvasGroup, canvasEditors } = build({
					ensureCanvas: async () => {
						if (stuck) {
							return new DeferredPromise<undefined>().p;
						}
						canvasEditors.push(createCanvasEditor('Canvas 2'));
						return undefined;
					}
				});
				const switching = switcher.switchFolder(TARGET.fsPath);
				await vi.advanceTimersByTimeAsync(30_000);
				await switching;
				expect(curtain()).toHaveTextContent('did not finish starting');
				expect(canvasGroup.lock).toHaveBeenLastCalledWith(true);

				stuck = false;
				click('Retry Canvas');
				await vi.advanceTimersByTimeAsync(0);
				await vi.waitFor(() => expect(curtain()).toBeNull());
				expect(ensureCanvas).toHaveBeenCalledTimes(2);
			} finally {
				vi.useRealTimers();
			}
		});
	});

	it('does not touch the source folder flag until the transaction commits', async () => {
		const { switcher, calls, curtain, click, exit } = build({ stopExtensionHosts: async () => false });
		await switcher.switchFolder(TARGET.fsPath);
		expect(curtain()).toHaveTextContent('declined to stop');
		expect(calls.filter(call => call.startsWith('storage.'))).toEqual([]);

		click('Open Positron');
		await vi.waitFor(() => expect(exit).toHaveBeenCalled());
		// The stop was refused, so there is nothing to start again.
		expect(calls.slice(-2)).toEqual(['extensions.stop', 'canvas.exit']);
	});
});
