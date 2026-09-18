/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Vitest-only fixture. Lives under a `test/vitest/` directory so the build
// leaves it out (build/lib/compilation.ts filters that path segment, and
// src/tsconfig.json excludes it); vitest type-checks it through the tests that
// import it.

import { CodeWindow } from '../../../../../base/browser/window.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
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
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceContextService, WorkbenchState } from '../../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderResolution, ICanvasFolderResult } from '../../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { isStoredEditorLayoutHeld } from '../../../../browser/positronEditorPartsLayout.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { WorkspaceService } from '../../../../services/configuration/browser/configurationService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ILifecycleService, WillShutdownEvent } from '../../../../services/lifecycle/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronBackupHandoffService } from '../../../../services/workingCopy/electron-browser/positronBackupHandoff.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { CanvasPlaceholderInput } from '../../browser/canvasPlaceholderEditor.js';
import { CANVAS_WEBVIEW_VIEW_TYPE } from '../../common/positronCanvasMode.js';
import { CanvasFolderSwitcher } from '../../electron-browser/positronCanvasFolderSwitch.js';
import { IPositronCanvasService, PositronCanvasService } from '../../electron-browser/positronCanvasService.js';

/**
 * One stubbed workbench for every test of a Canvas folder switch, whichever
 * half is under test: `PositronCanvasService` (real service, stubbed
 * workbench), `CanvasFolderSwitcher` (stubbed service, stubbed workbench) or
 * both together. Every collaborator records the mutation it was asked for
 * into `calls`, in order, under a stable label, so the three suites assert
 * against one vocabulary.
 */

type TestContext = Pick<ReturnType<ReturnType<typeof createTestContainer>['build']>, 'instantiationService' | 'disposables'>;

/** Native window ids of the stubbed parts. */
export const MAIN_WINDOW_ID = 1;
export const AUX_WINDOW_ID = 1000;
export const DETACHED_WINDOW_ID = 2000;

/** The folder Canvas presents, and the one every switch targets. */
export const SOURCE = URI.file('/projects/gamma');
export const TARGET = URI.file('/projects/delta');
/** What the main process answers for `/projects/delta`. */
export const TARGET_RESOLUTION: ICanvasFolderResolution = { workspace: { id: 'delta', uri: TARGET }, physicalUri: TARGET };
const TARGET_RESULT: ICanvasFolderResult = { workspace: TARGET_RESOLUTION.workspace, backupPath: '/backups/delta' };

/** A plain editor with a name; never disposed, so never registered. */
export function createEditor(name: string): EditorInput {
	return stubInterface<EditorInput>({ getName: () => name, isDisposed: () => false });
}

/** A Canvas panel, recognized by its contributed view type. */
export function createCanvasPanel(ctx: TestContext, name = 'Canvas'): WebviewInput {
	const editor = new WebviewInput(
		{ viewType: CANVAS_WEBVIEW_VIEW_TYPE, providedId: CANVAS_WEBVIEW_VIEW_TYPE, name, iconPath: undefined },
		stubInterface<IOverlayWebview>({ state: undefined, dispose: vi.fn() }),
		stubInterface<IThemeService>({ onDidColorThemeChange: Event.None }),
	);
	ctx.disposables.add(editor);
	return editor;
}

/**
 * A group with a fixed editor list. `editors` is tab order; `mruEditors` is
 * what the group reports for `EditorsOrder.MOST_RECENTLY_ACTIVE`, a different
 * order whenever a group holds more than one editor.
 */
export function createGroup(editors: WebviewInput[] = [], mruEditors: WebviewInput[] = editors): IEditorGroup {
	return stubInterface<IEditorGroup>({
		editors,
		getEditors: (order: EditorsOrder) => order === EditorsOrder.MOST_RECENTLY_ACTIVE ? mruEditors : editors,
		lock: vi.fn(),
		focus: vi.fn(),
		isActive: vi.fn().mockReturnValue(true),
		isSticky: vi.fn().mockReturnValue(false),
		getIndexOfEditor: vi.fn().mockReturnValue(0),
		moveEditors: vi.fn().mockReturnValue(true),
	});
}

/**
 * A group whose editor list the code under test rearranges, recording every
 * open, close, lock and move into `calls` as `<name>.<mutation>`.
 */
export function createLiveGroup(name: string, id: number, calls: string[], editors: EditorInput[]): IEditorGroup {
	return stubInterface<IEditorGroup>({
		id,
		editors,
		get count() { return editors.length; },
		isLocked: true,
		getEditors: (_order: EditorsOrder) => editors,
		lock: vi.fn((locked: boolean) => { calls.push(`${name}.lock(${locked})`); }),
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
		moveEditors: vi.fn(() => {
			calls.push(`${name}.moveEditors`);
			return true;
		}),
	});
}

/** An editor part in a window of its own (or the main one, by window id). */
export function createPart(activeGroup: IEditorGroup, onWillDispose: Event<void> = Event.None, windowId = AUX_WINDOW_ID, groups: IEditorGroup[] = [activeGroup]): IAuxiliaryEditorPart {
	return stubInterface<IAuxiliaryEditorPart>({ activeGroup, groups, onWillDispose, close: vi.fn(), windowId });
}

export function createSession(name: string, state = RuntimeState.Idle): ILanguageRuntimeSession {
	return stubInterface<ILanguageRuntimeSession>({
		sessionId: `${name}-id`,
		dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: name }),
		getRuntimeState: () => state,
	});
}

export interface ICanvasWorldOptions {
	/** Where collaborators record their mutations; a fresh list unless given. */
	calls?: string[];

	// The workbench: groups, parts and windows.

	/** Groups in the Canvas window, most recently active first; none means no Canvas window yet. */
	auxiliaryGroups?: IEditorGroup[];
	mainGroup?: IEditorGroup;
	/** Groups beyond the Canvas and main ones, e.g. one in a detached window. */
	extraGroups?: IEditorGroup[];
	/** Parts beyond the Canvas and main ones, e.g. detached editor windows. */
	extraParts?: IEditorPart[];
	/** The main editor part; an `EditorPart` gets its stored layout applied by a switch. */
	mainPart?: IEditorPart;
	/** Report every auxiliary window as plain, without the locked-compact trait. */
	plainAuxWindows?: boolean;
	/** The Canvas window going away. */
	onWillDispose?: Event<void>;

	// The Canvas half's collaborators.

	/** The assistant's ensure command. */
	executeCommand?: () => Promise<undefined>;
	createAuxiliaryEditorPart?: IEditorGroupsService['createAuxiliaryEditorPart'];
	acquireGranted?: boolean | Promise<boolean>;
	/** Resolves whether the call hid a visible window; see INativeHostService. */
	hideWindow?: (options?: { targetWindowId?: number }) => Promise<boolean>;
	showWindow?: (options?: { targetWindowId?: number }) => Promise<void>;
	/** The window reload; by default it fires `onWillShutdown`, an accepted reload. */
	reload?: () => Promise<void>;
	willShutdown?: boolean;

	// The workspace half's collaborators.

	aiEnabled?: boolean;
	remoteAuthority?: string;
	workbenchState?: WorkbenchState;
	hasDirty?: boolean;
	/** URIs the trust service reports as untrusted. */
	untrusted?: URI[];
	/** What the main process answers for `resolveCanvasFolder`. */
	resolve?: () => Promise<ICanvasFolderResolution>;
	/** What the main process answers for `enterCanvasFolder`; called per attempt. */
	enter?: () => Promise<ICanvasFolderResult>;
	/** Runtime sessions; one idle R session unless given. */
	sessions?: ILanguageRuntimeSession[];
	deleteSession?: (sessionId: string) => Promise<boolean>;
	stopExtensionHosts?: () => Promise<boolean>;
	startExtensionHosts?: () => Promise<void>;
	initialize?: () => Promise<void>;
	switchStorage?: () => Promise<void>;
}

/** Everything but the Canvas service itself, which each entry point registers. */
function installWorld(ctx: TestContext, options: ICanvasWorldOptions) {
	const calls = options.calls ?? [];
	const auxiliaryGroups = options.auxiliaryGroups ?? [];
	const mainGroup = options.mainGroup ?? createGroup();
	const mainPart = options.mainPart ?? createPart(mainGroup, Event.None, MAIN_WINDOW_ID);
	const auxiliaryPart = createPart(auxiliaryGroups.at(0) ?? createGroup(), options.onWillDispose ?? Event.None, AUX_WINDOW_ID, auxiliaryGroups);
	const groups = [...auxiliaryGroups, mainGroup, ...(options.extraGroups ?? [])];
	const parts = new Map<IEditorGroup, IEditorPart>(auxiliaryGroups.map(group => [group, auxiliaryPart]));
	parts.set(mainGroup, mainPart);

	const canvasContainer = document.createElement('div');
	document.body.appendChild(canvasContainer);
	ctx.disposables.add(toDisposable(() => canvasContainer.remove()));

	const executeCommand = vi.fn(options.executeCommand ?? (() => Promise.resolve(undefined)));
	const mergeGroup = vi.fn(() => { calls.push('merge'); return true; });
	const setPartHidden = vi.fn();
	const hideWindow = vi.fn(options.hideWindow ?? (() => Promise.resolve(true)));
	const showWindow = vi.fn(async (showOptions?: { targetWindowId?: number }) => {
		calls.push('window.show');
		await options.showWindow?.(showOptions);
	});
	const createAuxiliaryEditorPart = vi.fn(options.createAuxiliaryEditorPart ?? (() => Promise.resolve(auxiliaryPart)));
	const focus = vi.fn().mockResolvedValue(undefined);
	const willShutdownEmitter = ctx.disposables.add(new Emitter<WillShutdownEvent>());
	const reload = vi.fn(async () => {
		calls.push('host.reload');
		if (options.reload) {
			await options.reload();
		} else {
			willShutdownEmitter.fire(stubInterface<WillShutdownEvent>());
		}
	});
	const storageService = stubInterface<IStorageService>({
		store: vi.fn(() => { calls.push('storage.store'); }),
		remove: vi.fn(() => { calls.push('storage.remove'); }),
		switch: vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => {
			calls.push(`storage.switch(${workspace.uri.path}) held=${isStoredEditorLayoutHeld()}`);
			await options.switchStorage?.();
		}),
	});
	const initialize = vi.fn(async (workspace: ISingleFolderWorkspaceIdentifier) => {
		calls.push(`workspace.initialize(${workspace.uri.path})`);
		await options.initialize?.();
	});
	const deleteSession = vi.fn(async (sessionId: string) => {
		calls.push(`runtime.delete(${sessionId})`);
		return options.deleteSession ? options.deleteSession(sessionId) : true;
	});
	const stopExtensionHosts = vi.fn(async () => {
		calls.push('extensions.stop');
		return options.stopExtensionHosts ? options.stopExtensionHosts() : true;
	});
	const startExtensionHosts = vi.fn(async () => {
		calls.push('extensions.start');
		await options.startExtensionHosts?.();
	});
	const rehome = vi.fn(async (home: URI | undefined, closeSource: () => Promise<void>) => {
		calls.push(`backup.rehome(${home?.toString() ?? 'in-memory'})`);
		await closeSource();
	});
	// One stub serves both main-process channels (standalone mode and
	// workspaces); the command name tells them apart.
	const channelCall = vi.fn(async (command: string, args?: unknown[]) => {
		switch (command) {
			case 'acquire': return options.acquireGranted ?? true;
			case 'release': calls.push('main.release'); return undefined;
			case 'requestIdeRecovery': calls.push('main.requestIdeRecovery'); return undefined;
			case 'cancelIdeRecovery': calls.push('main.cancelIdeRecovery'); return undefined;
			case 'resolveCanvasFolder': return options.resolve ? options.resolve() : TARGET_RESOLUTION;
			case 'enterCanvasFolder':
				calls.push(`main.enterCanvasFolder(${(args![1] as URI).path})`);
				return options.enter ? options.enter() : TARGET_RESULT;
			default: throw new Error(`unexpected channel call ${command}`);
		}
	});

	// Each native window id gets its own `Window` object, so focus
	// suppression can be told apart per window.
	const auxiliaryWindows = new Map<number, CodeWindow>();
	const auxiliaryWindowFor = (windowId: number) => {
		let window = auxiliaryWindows.get(windowId);
		if (!window) {
			window = stubInterface<CodeWindow>();
			auxiliaryWindows.set(windowId, window);
		}
		return window;
	};

	const { instantiationService } = ctx;
	instantiationService.stub(IEditorGroupsService, stubInterface<IEditorGroupsService>({
		mainPart,
		parts: [auxiliaryPart, ...(options.extraParts ?? []), mainPart],
		groups,
		getGroups: () => groups,
		getGroup: (id: number) => groups.find(group => group.id === id),
		getPart: (group: IEditorGroup) => parts.get(group) ?? mainPart,
		mergeGroup,
		createAuxiliaryEditorPart,
	}));
	// Every auxiliary window carries the dedicated locked-compact trait
	// unless the test says otherwise.
	instantiationService.stub(IAuxiliaryWindowService, stubInterface<IAuxiliaryWindowService>({
		getWindow: (windowId: number) => stubInterface<IAuxiliaryWindow>({
			window: auxiliaryWindowFor(windowId),
			container: canvasContainer,
			createState: () => options.plainAuxWindows === true ? {} : { lockCompact: true }
		})
	}));
	instantiationService.stub(ICommandService, stubInterface<ICommandService>({ executeCommand }));
	instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => options.aiEnabled ?? true }));
	instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ windowId: MAIN_WINDOW_ID, hideWindow, showWindow }));
	instantiationService.stub(IHostService, stubInterface<IHostService>({ focus, reload }));
	instantiationService.stub(IWorkbenchLayoutService, stubInterface<IWorkbenchLayoutService>({ setPartHidden }));
	instantiationService.stub(IStorageService, storageService);
	instantiationService.stub(ILifecycleService, stubInterface<ILifecycleService>({ willShutdown: options.willShutdown === true, onWillShutdown: willShutdownEmitter.event }));
	instantiationService.stub(ILogService, new NullLogService());
	instantiationService.stub(IContextKeyService, new MockContextKeyService());
	instantiationService.stub(IMainProcessService, stubInterface<IMainProcessService>({
		getChannel: () => stubInterface<IChannel>({ call: channelCall as IChannel['call'] })
	}));
	instantiationService.stub(IWorkspaceContextService, stubInterface<WorkspaceService>({
		getWorkbenchState: () => options.workbenchState ?? WorkbenchState.FOLDER,
		getWorkspace: () => stubInterface<ReturnType<WorkspaceService['getWorkspace']>>({ folders: [stubInterface<ReturnType<WorkspaceService['getWorkspace']>['folders'][number]>({ uri: SOURCE })] }),
		initialize,
	}));
	instantiationService.stub(INativeWorkbenchEnvironmentService, stubInterface<INativeWorkbenchEnvironmentService>({
		remoteAuthority: options.remoteAuthority,
		userRoamingDataHome: URI.from({ scheme: 'vscode-userdata', path: '/roaming' }),
	}));
	instantiationService.stub(IExtensionService, stubInterface<IExtensionService>({ stopExtensionHosts, startExtensionHosts }));
	instantiationService.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ activeSessions: options.sessions ?? [createSession('R')], deleteSession }));
	instantiationService.stub(IPositronBackupHandoffService, stubInterface<IPositronBackupHandoffService>({ rehome }));
	instantiationService.stub(IWorkingCopyService, stubInterface<IWorkingCopyService>({ hasDirty: options.hasDirty ?? false }));
	instantiationService.stub(IWorkspaceTrustManagementService, stubInterface<IWorkspaceTrustManagementService>({
		getUriTrustInfo: async (uri: URI) => ({ uri, trusted: !(options.untrusted ?? []).some(untrusted => untrusted.toString() === uri.toString()) })
	}));
	instantiationService.stub(IWorkspacesService, stubInterface<IWorkspacesService>({ addRecentlyOpened: async () => { calls.push('recents.add'); } }));

	// The curtain is plain DOM built by the Monaco Button widget, not React;
	// no semantic query reaches it.
	/** The curtain element while it is up, `null` once it came down. */
	const curtain = () => canvasContainer.getElementsByClassName('positron-canvas-startup-curtain').item(0);
	/** The curtain's buttons by label, `[]` while it is loading; the Button widget renders each as `.monaco-button`. */
	const buttons = () => Array.from(canvasContainer.getElementsByClassName('monaco-button')).map(element => element.textContent);
	/** Clicks the curtain button labelled `name`. */
	const click = (name: string) => {
		const button = Array.from(canvasContainer.getElementsByClassName('monaco-button')).find(element => element.textContent === name);
		if (!button) {
			throw new Error(`no curtain button "${name}"`);
		}
		(button as HTMLElement).click();
	};

	// The switcher wants the Canvas service registered, which the entry
	// points do after this returns; so it is created on first use.
	let switcher: CanvasFolderSwitcher | undefined;
	const getSwitcher = () => switcher ??= instantiationService.createInstance(CanvasFolderSwitcher);
	/** Starts a switch and reports how its promise settled, `'pending'` until it does. */
	const start = (folderPath = TARGET.fsPath) => {
		let outcome = 'pending';
		const promise = getSwitcher().switchFolder(folderPath).then(() => { outcome = 'resolved'; }, (error: Error) => { outcome = `rejected: ${error.message}`; });
		return { promise, outcome: () => outcome };
	};

	return {
		calls, canvasContainer, mainGroup, mainPart, auxiliaryPart,
		executeCommand, storageService, mergeGroup, setPartHidden, hideWindow, showWindow, channelCall, focus, createAuxiliaryEditorPart, reload, startExtensionHosts, willShutdownEmitter, auxiliaryWindowFor,
		get switcher() { return getSwitcher(); },
		start, curtain, buttons, click,
	};
}

export type ICanvasWorld = ReturnType<typeof installWorld>;

/** The real `PositronCanvasService` over the stubbed workbench. */
export function canvasWorld(ctx: TestContext, options: ICanvasWorldOptions = {}): ICanvasWorld & { service: PositronCanvasService } {
	const world = installWorld(ctx, options);
	const service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronCanvasService));
	ctx.instantiationService.stub(IPositronCanvasService, service);
	return Object.assign(world, { service });
}

export interface ISwitcherWorldOptions extends ICanvasWorldOptions {
	canvasActive?: boolean;
	/** Makes the Canvas half fail after the workspace half, once per value. */
	restoreFailures?: string[];
	/** Whether `reloadIntoIde` reports an accepted reload. */
	reloadAccepted?: boolean;
	/** Editors open in the IDE window before the switch; `a.txt` and `b.txt` unless given. */
	mainEditors?: EditorInput[];
}

/**
 * The real `CanvasFolderSwitcher` over a stubbed Canvas service whose
 * `rebuild` runs the workspace half with a token the test controls
 * (`cancel`) and then "restores" the panel unless told to fail. The Canvas
 * window's group holds the placeholder from the start, as it would inside a
 * real rebuild.
 */
export function switcherWorld(ctx: TestContext, options: ISwitcherWorldOptions = {}) {
	const calls = options.calls ?? [];
	const placeholder = ctx.disposables.add(new CanvasPlaceholderInput());
	const mainEditors = options.mainEditors ?? [createEditor('a.txt'), createEditor('b.txt')];
	const canvasGroup = createLiveGroup('canvas', 1, calls, [placeholder]);
	const mainGroup = createLiveGroup('main', 2, calls, mainEditors);
	const world = installWorld(ctx, { ...options, calls, auxiliaryGroups: [canvasGroup], mainGroup });

	const cancellation = ctx.disposables.add(new CancellationTokenSource());
	const activeChanges = ctx.disposables.add(new Emitter<boolean>());
	const restoreFailures = [...(options.restoreFailures ?? [])];
	const rebuild = vi.fn(async (between: (token: CancellationToken) => Promise<void>) => {
		calls.push('canvas.rebuild');
		await between(cancellation.token);
		if (cancellation.token.isCancellationRequested) {
			throw new CancellationError();
		}
		const failure = restoreFailures.shift();
		if (failure) {
			throw new Error(failure);
		}
		calls.push('canvas.restore');
	});
	const exit = vi.fn(async () => { calls.push('canvas.exit'); activeChanges.fire(false); return true; });
	const reloadIntoIde = vi.fn(async () => { calls.push('canvas.reloadIntoIde'); return options.reloadAccepted ?? true; });
	ctx.instantiationService.stub(IPositronCanvasService, stubInterface<IPositronCanvasService>({
		isActive: options.canvasActive ?? true,
		canvasContainer: world.canvasContainer,
		onDidChangeActive: activeChanges.event,
		rebuild,
		exit,
		reloadIntoIde,
	}));

	return Object.assign(world, {
		canvasGroup, mainEditors, rebuild, exit, reloadIntoIde,
		/** Cancels the token the stubbed rebuild handed to the workspace half. */
		cancel: () => cancellation.cancel(),
		/** Canvas stopped presenting, as the service announces after an exit or a lost window. */
		canvasGone: () => activeChanges.fire(false),
	});
}

export interface IPresentOptions extends Omit<ICanvasWorldOptions, 'calls' | 'auxiliaryGroups' | 'mainGroup' | 'executeCommand'> {
	/** Where the assistant builds the rebuilt panel; the Canvas window unless told otherwise. */
	rebuildIn?: 'canvas' | 'main';
	/** What the assistant does when asked for the rebuilt panel, instead of producing "Panel 2". */
	ensure?: () => Promise<undefined>;
	/** Editors open in the IDE window before the switch; none unless given. */
	mainEditors?: EditorInput[];
}

/**
 * The real Canvas service presenting a panel named "Panel" in its own
 * window, with the assistant producing "Panel 2" on the next ensure. The
 * entry's own ensure is the first call and produces nothing new; `calls`
 * starts empty after the entry.
 */
export async function presentCanvas(ctx: TestContext, options: IPresentOptions = {}) {
	const calls: string[] = [];
	const canvasEditors: EditorInput[] = [createCanvasPanel(ctx, 'Panel')];
	const mainEditors = options.mainEditors ?? [];
	const canvasGroup = createLiveGroup('canvas', 1, calls, canvasEditors);
	const mainGroup = createLiveGroup('main', 2, calls, mainEditors);
	let ensures = 0;
	const world = canvasWorld(ctx, {
		...options,
		calls,
		auxiliaryGroups: [canvasGroup],
		mainGroup,
		executeCommand: async () => {
			if (ensures++ === 0) {
				return undefined;
			}
			calls.push('assistant.ensure');
			if (options.ensure) {
				return options.ensure();
			}
			(options.rebuildIn === 'main' ? mainEditors : canvasEditors).push(createCanvasPanel(ctx, 'Panel 2'));
			return undefined;
		},
	});
	// The stub groups do not dispose what they close; a placeholder a test
	// leaves behind on purpose is dropped here.
	ctx.disposables.add(toDisposable(() => {
		for (const editor of [...canvasEditors, ...mainEditors]) {
			if (editor instanceof EditorInput) {
				editor.dispose();
			}
		}
	}));

	expect(await world.service.enter()).toEqual({ entered: true });
	calls.length = 0;

	return Object.assign(world, {
		canvasGroup, canvasEditors, mainEditors,
		/** Editor names per group, the observable end state of a rebuild. */
		names: () => ({ canvas: canvasEditors.map(editor => editor.getName()), main: mainEditors.map(editor => editor.getName()) }),
	});
}
