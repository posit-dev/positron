/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CodeWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { POSITRON_STANDALONE_MODE_CHANNEL_NAME } from '../../../../../platform/positronStandaloneMode/common/positronStandaloneMode.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderResult } from '../../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { WorkspaceService } from '../../../../services/configuration/browser/configurationService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronBackupHandoffService } from '../../../../services/workingCopy/electron-browser/positronBackupHandoff.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_WEBVIEW_VIEW_TYPE } from '../../common/positronCanvasMode.js';
import { CanvasFolderSwitcher } from '../../electron-browser/positronCanvasFolderSwitch.js';
import { IPositronCanvasService, PositronCanvasService } from '../../electron-browser/positronCanvasService.js';

const SOURCE = URI.file('/projects/gamma');
const TARGET = URI.file('/projects/delta');
const TARGET_WORKSPACE: ISingleFolderWorkspaceIdentifier = { id: 'delta', uri: TARGET };

/**
 * The real Canvas service and the real switcher over stub groups and
 * channels: the contract between the two halves of a switch, which each
 * unit test file otherwise only stubs.
 */
describe('Canvas folder switch (service + switcher)', () => {
	const ctx = createTestContainer().build();

	function createCanvasEditor(name: string): WebviewInput {
		const editor = new WebviewInput(
			{ viewType: CANVAS_WEBVIEW_VIEW_TYPE, providedId: CANVAS_WEBVIEW_VIEW_TYPE, name, iconPath: undefined },
			stubInterface<IOverlayWebview>({ state: undefined, dispose: vi.fn() }),
			stubInterface<IThemeService>({ onDidColorThemeChange: Event.None }),
		);
		ctx.disposables.add(editor);
		return editor;
	}

	function createLiveGroup(name: string, id: number, calls: string[], editors: EditorInput[]): IEditorGroup {
		return stubInterface<IEditorGroup>({
			id,
			editors,
			get count() { return editors.length; },
			isLocked: true,
			getEditors: (_order: EditorsOrder) => editors,
			lock: vi.fn(),
			focus: vi.fn(),
			isActive: () => true,
			isSticky: () => false,
			getIndexOfEditor: (editor: EditorInput) => editors.indexOf(editor),
			contains: (editor: EditorInput) => editors.includes(editor),
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
			closeEditors: vi.fn(async (toClose: EditorInput[]) => {
				calls.push(`${name}.closeEditors(${toClose.map(editor => editor.getName()).join(',')})`);
				for (const editor of toClose) {
					editors.splice(editors.indexOf(editor), 1);
				}
				return true;
			}),
			moveEditors: vi.fn(() => true),
		});
	}

	async function present(options: {
		enter?: () => Promise<ICanvasFolderResult>;
		initialize?: () => Promise<void>;
		/** Delays the rebuilt panel until resolved. */
		ensure?: DeferredPromise<undefined>;
	} = {}) {
		const calls: string[] = [];
		const canvasEditors: EditorInput[] = [createCanvasEditor('Panel')];
		const mainEditors: EditorInput[] = [stubInterface<EditorInput>({ getName: () => 'a.txt', isDisposed: () => false })];
		const canvasGroup = createLiveGroup('canvas', 1, calls, canvasEditors);
		const mainGroup = createLiveGroup('main', 2, calls, mainEditors);
		const groups = [canvasGroup, mainGroup];
		const willDispose = ctx.disposables.add(new Emitter<void>());
		const canvasPart = stubInterface<IAuxiliaryEditorPart>({ activeGroup: canvasGroup, groups: [canvasGroup], onWillDispose: willDispose.event, windowId: 1000, close: vi.fn() });
		const mainPart = stubInterface<IEditorPart>({ activeGroup: mainGroup, groups: [mainGroup], onWillDispose: Event.None, windowId: 1 });
		const container = document.createElement('div');
		document.body.appendChild(container);
		ctx.disposables.add(toDisposable(() => {
			container.remove();
			for (const editor of canvasEditors) {
				editor.dispose();
			}
		}));

		let ensures = 0;
		const executeCommand = vi.fn(async () => {
			if (ensures++ === 0) {
				return undefined;
			}
			calls.push('assistant.ensure');
			await options.ensure?.p;
			canvasEditors.push(createCanvasEditor('Panel 2'));
			return undefined;
		});
		const channelCall = vi.fn(async (command: string, args: unknown[]) => {
			switch (command) {
				case 'acquire': return true;
				case 'release': calls.push('main.release'); return undefined;
				case 'requestIdeRecovery': calls.push('main.requestIdeRecovery'); return undefined;
				case 'cancelIdeRecovery': return undefined;
				case 'resolveCanvasFolder': return { workspace: TARGET_WORKSPACE, physicalUri: TARGET };
				case 'enterCanvasFolder':
					calls.push(`main.enterCanvasFolder(${(args[1] as URI).path})`);
					return options.enter ? options.enter() : { workspace: TARGET_WORKSPACE, backupPath: undefined };
				default: throw new Error(`unexpected channel call ${command}`);
			}
		});
		const storageService = stubInterface<IStorageService>({
			store: vi.fn(() => { calls.push('storage.store'); }),
			remove: vi.fn(() => { calls.push('storage.remove'); }),
			switch: vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => { calls.push(`storage.switch(${workspace.uri.path})`); }),
		});
		const willShutdown = ctx.disposables.add(new Emitter<WillShutdownEvent>());

		ctx.instantiationService.stub(IEditorGroupsService, stubInterface<IEditorGroupsService>({
			mainPart,
			parts: [canvasPart, mainPart],
			groups,
			getGroups: () => groups,
			getGroup: (id: number) => groups.find(group => group.id === id),
			getPart: (group: IEditorGroup) => group === canvasGroup ? canvasPart : mainPart,
			mergeGroup: vi.fn(() => { calls.push('merge'); return true; }),
		}));
		ctx.instantiationService.stub(IAuxiliaryWindowService, stubInterface<IAuxiliaryWindowService>({
			getWindow: () => stubInterface<IAuxiliaryWindow>({ window: stubInterface<CodeWindow>(), container, createState: () => ({ lockCompact: true }) })
		}));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({ executeCommand }));
		ctx.instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => true }));
		ctx.instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ windowId: 1, hideWindow: async () => true, showWindow: async () => { calls.push('window.show'); } }));
		ctx.instantiationService.stub(IHostService, stubInterface<IHostService>({ focus: async () => { }, reload: vi.fn(async () => { calls.push('host.reload'); willShutdown.fire(stubInterface<WillShutdownEvent>()); }) }));
		ctx.instantiationService.stub(IWorkbenchLayoutService, stubInterface<IWorkbenchLayoutService>({ setPartHidden: vi.fn() }));
		ctx.instantiationService.stub(IStorageService, storageService);
		ctx.instantiationService.stub(ILifecycleService, stubInterface<ILifecycleService>({ willShutdown: false, onWillShutdown: willShutdown.event }));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IContextKeyService, new MockContextKeyService());
		ctx.instantiationService.stub(IMainProcessService, stubInterface<IMainProcessService>({
			getChannel: (name: string) => stubInterface<IChannel>({ call: ((command: string, args: unknown[]) => channelCall(name === POSITRON_STANDALONE_MODE_CHANNEL_NAME ? command : command, args)) as IChannel['call'] })
		}));
		ctx.instantiationService.stub(IWorkspaceContextService, stubInterface<WorkspaceService>({
			getWorkbenchState: () => WorkbenchState.FOLDER,
			getWorkspace: () => stubInterface<ReturnType<WorkspaceService['getWorkspace']>>({ folders: [stubInterface<ReturnType<WorkspaceService['getWorkspace']>['folders'][number]>({ uri: SOURCE })] }),
			initialize: vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => { calls.push(`workspace.initialize(${workspace.uri.path})`); await options.initialize?.(); }),
		}));
		ctx.instantiationService.stub(INativeWorkbenchEnvironmentService, stubInterface<INativeWorkbenchEnvironmentService>({ remoteAuthority: undefined, userRoamingDataHome: URI.file('/roaming'), isBuilt: true }));
		ctx.instantiationService.stub(IExtensionService, stubInterface<IExtensionService>({
			stopExtensionHosts: vi.fn(async () => { calls.push('extensions.stop'); return true; }),
			startExtensionHosts: vi.fn(async () => { calls.push('extensions.start'); }),
		}));
		ctx.instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ activeSessions: [] }));
		ctx.instantiationService.stub(IPositronBackupHandoffService, stubInterface<IPositronBackupHandoffService>({ rehome: async (_home: URI | undefined, closeSource: () => Promise<void>) => { calls.push('backup.rehome'); await closeSource(); } }));
		ctx.instantiationService.stub(IWorkingCopyService, stubInterface<IWorkingCopyService>({ hasDirty: false }));
		ctx.instantiationService.stub(IWorkspaceTrustManagementService, stubInterface<IWorkspaceTrustManagementService>({ getUriTrustInfo: async (uri: URI) => ({ uri, trusted: true }) }));
		ctx.instantiationService.stub(IWorkspacesService, stubInterface<IWorkspacesService>({ addRecentlyOpened: async () => { calls.push('recents.add'); } }));

		const service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronCanvasService));
		ctx.instantiationService.stub(IPositronCanvasService, service);
		expect(await service.enter()).toEqual({ entered: true });
		calls.length = 0;

		const switcher = ctx.instantiationService.createInstance(CanvasFolderSwitcher);
		const start = () => {
			let outcome = 'pending';
			const promise = switcher.switchFolder(TARGET.fsPath).then(() => { outcome = 'resolved'; }, (error: Error) => { outcome = `rejected: ${error.message}`; });
			return { promise, outcome: () => outcome };
		};
		const names = () => ({ canvas: canvasEditors.map(editor => editor.getName()), main: mainEditors.map(editor => editor.getName()) });
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		const curtain = () => container.getElementsByClassName('positron-canvas-startup-curtain').item(0);
		return { service, switcher, start, calls, names, curtain, willDispose, mainPart };
	}

	it('switches folders in the Canvas window: placeholder, workspace half, fresh panel, flag on the destination', async () => {
		const { service, start, calls, names, curtain } = await present();

		const { promise, outcome } = start();
		await promise;

		expect(calls).toMatchInlineSnapshot(`
			[
			  "canvas.open(Canvas)",
			  "canvas.close(Panel)",
			  "storage.remove",
			  "extensions.stop",
			  "main.enterCanvasFolder(/projects/delta)",
			  "workspace.initialize(/projects/delta)",
			  "storage.switch(/projects/delta)",
			  "backup.rehome",
			  "main.closeEditors(a.txt)",
			  "recents.add",
			  "extensions.start",
			  "assistant.ensure",
			  "canvas.open(Panel 2)",
			  "canvas.close(Canvas)",
			  "storage.store",
			]
		`);
		expect({ outcome: outcome(), names: names(), active: service.isActive, curtain: curtain() }).toEqual({ outcome: 'resolved', names: { canvas: ['Panel 2'], main: [] }, active: true, curtain: null });
	});

	it('an exit during the main-process commit waits for the renderer to match it, then hands back the IDE', async () => {
		const entering = new DeferredPromise<ICanvasFolderResult>();
		const { service, start, calls, names } = await present({ enter: () => entering.p });

		const { promise, outcome } = start();
		await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

		const exiting = service.exit();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		expect({ merged: calls.includes('merge'), released: calls.includes('main.release') }).toEqual({ merged: false, released: false });

		await entering.complete({ workspace: TARGET_WORKSPACE, backupPath: undefined });
		await promise;
		expect(await exiting).toBe(true);

		expect(calls.slice(calls.indexOf('workspace.initialize(/projects/delta)'))).toEqual([
			'workspace.initialize(/projects/delta)',
			'storage.switch(/projects/delta)',
			'backup.rehome',
			'main.closeEditors(a.txt)',
			'recents.add',
			'extensions.start',
			'storage.remove',
			'window.show',
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

	it('an exit while the renderer cannot follow the committed folder reloads into the IDE', async () => {
		const entering = new DeferredPromise<ICanvasFolderResult>();
		const { service, start, calls } = await present({ enter: () => entering.p, initialize: () => Promise.reject(new Error('init failed')) });

		const { promise, outcome } = start();
		await vi.waitFor(() => expect(calls).toContain('main.enterCanvasFolder(/projects/delta)'));

		const exiting = service.exit();
		await entering.complete({ workspace: TARGET_WORKSPACE, backupPath: undefined });
		await promise;
		await exiting;

		expect({ outcome: outcome(), recovery: calls.filter(call => call === 'main.requestIdeRecovery' || call === 'host.reload') })
			.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', recovery: ['main.requestIdeRecovery', 'host.reload'] });
	});

	it('the Canvas window closing during the assistant rebuild discards the late panel and releases the claim afterwards', async () => {
		const ensure = new DeferredPromise<undefined>();
		const { service, start, calls, names, willDispose } = await present({ ensure });

		const { promise, outcome } = start();
		await vi.waitFor(() => expect(calls).toContain('assistant.ensure'));

		willDispose.fire();
		expect({ active: service.isActive, released: calls.includes('main.release') }).toEqual({ active: false, released: false });

		await ensure.complete(undefined);
		await promise;
		await vi.waitFor(() => expect(calls).toContain('main.release'));

		expect({ outcome: outcome(), adopted: calls.includes('canvas.open(Panel 2)'), stores: calls.filter(call => call === 'storage.store').length, names: names() })
			.toEqual({ outcome: 'rejected: Canvas was closed while switching workspaces.', adopted: false, stores: 0, names: { canvas: ['Panel 2'], main: [] } });
	});

	it('Retry after a failed commit resumes with the same placeholder and does not repeat the detach', async () => {
		let attempts = 0;
		const { start, calls, names, curtain } = await present({
			enter: async () => {
				if (attempts++ === 0) {
					throw new Error('gone');
				}
				return { workspace: TARGET_WORKSPACE, backupPath: undefined };
			}
		});

		const { promise, outcome } = start();
		await vi.waitFor(() => expect(curtain()).toHaveTextContent('gone'));
		// eslint-disable-next-line no-restricted-syntax -- non-React DOM; no semantic query available here
		const retry = Array.from(document.getElementsByClassName('monaco-button')).find(element => element.textContent === 'Retry Canvas') as HTMLElement;
		retry.click();
		await promise;

		expect({
			outcome: outcome(),
			placeholders: calls.filter(call => call === 'canvas.open(Canvas)').length,
			stops: calls.filter(call => call === 'extensions.stop').length,
			commits: calls.filter(call => call.startsWith('main.enterCanvasFolder')).length,
			names: names(),
		}).toEqual({ outcome: 'resolved', placeholders: 1, stops: 1, commits: 2, names: { canvas: ['Panel 2'], main: [] } });
	});
});
