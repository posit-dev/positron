/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { mainWindow } from '../../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { EditorsOrder } from '../../../../common/editor.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { IOverlayWebview } from '../../../webview/browser/webview.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE } from '../../common/positronCanvasMode.js';
import { PositronCanvasService } from '../../electron-browser/positronCanvasService.js';

/** The command the assistant contributes to produce a Canvas panel. */
const CANVAS_ENSURE_COMMAND = 'posit-assistant.ensureCanvas';

/** Native window ids for the stubbed parts. */
const MAIN_WINDOW_ID = 1;
const AUX_WINDOW_ID = 1000;
const DETACHED_WINDOW_ID = 2000;

describe('PositronCanvasService', () => {
	const ctx = createTestContainer().build();

	/**
	 * A group whose editor list the test can rearrange.
	 *
	 * `editors` is tab order; `mruEditors` is what the group reports for
	 * `EditorsOrder.MOST_RECENTLY_ACTIVE`, which is a different order whenever a
	 * group holds more than one editor.
	 */
	function createGroup(editors: WebviewInput[] = [], mruEditors: WebviewInput[] = editors): IEditorGroup {
		const group = stubInterface<IEditorGroup>({
			editors,
			getEditors: (order: EditorsOrder) => order === EditorsOrder.MOST_RECENTLY_ACTIVE ? mruEditors : editors,
			lock: vi.fn(),
			focus: vi.fn(),
			isActive: vi.fn().mockReturnValue(true),
			isSticky: vi.fn().mockReturnValue(false),
			getIndexOfEditor: vi.fn().mockReturnValue(0),
			moveEditors: vi.fn().mockReturnValue(true),
		});
		return group;
	}

	function createPart(activeGroup: IEditorGroup, onWillDispose: Event<void> = Event.None, windowId = AUX_WINDOW_ID): IAuxiliaryEditorPart {
		return stubInterface<IAuxiliaryEditorPart>({ activeGroup, onWillDispose, close: vi.fn(), windowId });
	}

	/** A Canvas panel, recognized by its contributed view type. */
	function createCanvasEditor(): WebviewInput {
		const editor = new WebviewInput(
			{ viewType: CANVAS_WEBVIEW_VIEW_TYPE, providedId: CANVAS_WEBVIEW_VIEW_TYPE, name: 'Canvas', iconPath: undefined },
			stubInterface<IOverlayWebview>({ state: undefined, dispose: vi.fn() }),
			stubInterface<IThemeService>({ onDidColorThemeChange: Event.None }),
		);
		ctx.disposables.add(editor);
		return editor;
	}

	/**
	 * Wires the service up over a workbench whose groups the test controls.
	 *
	 * `auxiliaryGroups` are the groups, in most-recently-active order, that live
	 * in a window of their own; the main part's group is always last, so a Canvas
	 * panel still in the IDE window loses the MRU race.
	 */
	function build(options: {
		auxiliaryGroups?: IEditorGroup[];
		mainGroup?: IEditorGroup;
		/** Parts beyond the main and Canvas ones, e.g. detached editor windows. */
		extraParts?: IEditorPart[];
		/** Report every auxiliary window as plain, without the locked-compact trait. */
		plainAuxWindows?: boolean;
		willShutdown?: boolean;
		onWillDispose?: Event<void>;
		executeCommand?: () => Promise<undefined>;
		createAuxiliaryEditorPart?: IEditorGroupsService['createAuxiliaryEditorPart'];
		acquireGranted?: boolean | Promise<boolean>;
		/** Resolves whether the call hid a visible window; see INativeHostService. */
		hideWindow?: (options?: { targetWindowId?: number }) => Promise<boolean>;
		showWindow?: (options?: { targetWindowId?: number }) => Promise<void>;
	} = {}) {
		const auxiliaryGroups = options.auxiliaryGroups ?? [];
		const mainGroup = options.mainGroup ?? createGroup();
		const mainPart = createPart(mainGroup, Event.None, MAIN_WINDOW_ID);
		const auxiliaryGroup = auxiliaryGroups.at(0);
		const auxiliaryPart = createPart(auxiliaryGroup ?? createGroup(), options.onWillDispose ?? Event.None);

		const parts = new Map<IEditorGroup, IEditorPart>(auxiliaryGroups.map(group => [group, auxiliaryPart]));
		parts.set(mainGroup, mainPart);

		const executeCommand = vi.fn(options.executeCommand ?? (() => Promise.resolve(undefined)));
		const storageService = stubInterface<IStorageService>({ store: vi.fn(), remove: vi.fn() });
		const mergeGroup = vi.fn().mockReturnValue(true);
		const setPartHidden = vi.fn();
		const hideWindow = vi.fn(options.hideWindow ?? (() => Promise.resolve(true)));
		const showWindow = vi.fn(options.showWindow ?? (() => Promise.resolve()));
		const createAuxiliaryEditorPart = vi.fn(options.createAuxiliaryEditorPart ?? (() => Promise.resolve(auxiliaryPart)));

		ctx.instantiationService.stub(IEditorGroupsService, stubInterface<IEditorGroupsService>({
			mainPart,
			parts: [auxiliaryPart, ...(options.extraParts ?? []), mainPart],
			getGroups: () => [...auxiliaryGroups, mainGroup],
			getPart: (group: IEditorGroup) => parts.get(group) ?? mainPart,
			mergeGroup,
			createAuxiliaryEditorPart,
		}));
		// Every auxiliary window carries the dedicated locked-compact trait
		// unless the test says otherwise.
		ctx.instantiationService.stub(IAuxiliaryWindowService, stubInterface<IAuxiliaryWindowService>({
			getWindow: () => stubInterface<IAuxiliaryWindow>({
				createState: () => options.plainAuxWindows === true ? {} : { lockCompact: true }
			})
		}));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({ executeCommand }));
		ctx.instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => true }));
		ctx.instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ hideWindow, showWindow }));
		const focus = vi.fn().mockResolvedValue(undefined);
		ctx.instantiationService.stub(IHostService, stubInterface<IHostService>({ focus }));
		ctx.instantiationService.stub(IWorkbenchLayoutService, stubInterface<IWorkbenchLayoutService>({ setPartHidden }));
		ctx.instantiationService.stub(IStorageService, storageService);
		ctx.instantiationService.stub(ILifecycleService, stubInterface<ILifecycleService>({ willShutdown: options.willShutdown === true }));
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IContextKeyService, new MockContextKeyService());
		// The engagement channel: `acquire` grants unless the test says
		// otherwise, `release` resolves. Recorded so tests can assert the
		// claim's lifecycle against the mode transaction.
		const channelCall = vi.fn().mockImplementation((command: string) =>
			Promise.resolve(command === 'acquire' ? (options.acquireGranted ?? true) : undefined));
		ctx.instantiationService.stub(IMainProcessService, stubInterface<IMainProcessService>({
			getChannel: () => stubInterface<IChannel>({ call: channelCall })
		}));

		const service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronCanvasService));

		return { service, mainGroup, auxiliaryPart, executeCommand, storageService, mergeGroup, setPartHidden, hideWindow, showWindow, channelCall, focus, createAuxiliaryEditorPart };
	}

	it('coalesces concurrent entries so the assistant is asked for one Canvas', async () => {
		const created = new DeferredPromise<undefined>();
		const canvasEditors: WebviewInput[] = [];
		const auxiliaryGroup = createGroup(canvasEditors);
		const { service, executeCommand } = build({
			auxiliaryGroups: [auxiliaryGroup],
			executeCommand: () => created.p,
		});

		const first = service.enter();
		const second = service.enter();

		// The ensure command runs once the entry has claimed Canvas mode with
		// the main process, one await in.
		await vi.waitFor(() => expect(executeCommand).toHaveBeenCalled());
		expect(executeCommand).toHaveBeenCalledTimes(1);
		expect(executeCommand).toHaveBeenCalledWith(CANVAS_ENSURE_COMMAND);

		// The command is what puts a Canvas panel in the workbench.
		canvasEditors.push(createCanvasEditor());
		await created.complete(undefined);

		expect(await Promise.all([first, second])).toEqual([{ entered: true }, { entered: true }]);
		expect(executeCommand).toHaveBeenCalledTimes(1);
	});

	it('reports a no-panel outcome when the assistant produces no Canvas', async () => {
		const { service, executeCommand } = build();

		const outcome = await service.enter();

		expect(executeCommand).toHaveBeenCalledWith(CANVAS_ENSURE_COMMAND);
		expect(outcome).toMatchObject({ entered: false, reason: 'no-panel' });
	});

	it('does not adopt a restored Canvas when the assistant cannot ensure it', async () => {
		const restored = createCanvasEditor();
		const mainGroup = createGroup([restored]);
		const { service, executeCommand, hideWindow } = build({
			mainGroup,
			executeCommand: () => Promise.reject(new Error('command not found')),
		});

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-panel' });

		expect(executeCommand).toHaveBeenCalledWith(CANVAS_ENSURE_COMMAND);
		expect(hideWindow).not.toHaveBeenCalled();
		expect(mainGroup.editors).toEqual([restored]);
	});

	it('presents the most recently active Canvas and leaves duplicates open', async () => {
		const recent = createCanvasEditor();
		const older = createCanvasEditor();
		const recentGroup = createGroup([recent]);
		const olderGroup = createGroup([older]);
		const { service, executeCommand } = build({ auxiliaryGroups: [recentGroup, olderGroup] });

		expect(await service.enter()).toEqual({ entered: true });

		// The MRU group is the one taken over; the duplicate keeps its editor.
		expect(recentGroup.lock).toHaveBeenCalledWith(true);
		expect(olderGroup.lock).not.toHaveBeenCalled();
		expect(olderGroup.editors).toEqual([older]);
		expect(executeCommand).toHaveBeenCalledWith(CANVAS_ENSURE_COMMAND);
	});

	it('presents the most recently used Canvas of two sharing a group', async () => {
		const older = createCanvasEditor();
		const recent = createCanvasEditor();
		// Tab order puts the older panel first; use order is the other way
		// round, and use order is what Canvas mode follows.
		const mainGroup = createGroup([older, recent], [recent, older]);
		const { service } = build({ mainGroup });

		expect(await service.enter()).toEqual({ entered: true });

		const moved = vi.mocked(mainGroup.moveEditors).mock.calls[0][0];
		expect(moved.map(entry => entry.editor)).toStrictEqual([recent]);
	});

	it('reports a no-panel outcome when the assistant runs past the create timeout', async () => {
		vi.useFakeTimers();
		try {
			const canvasEditors: WebviewInput[] = [];
			const mainGroup = createGroup(canvasEditors);
			// The assistant's webview panel exists as soon as it opens one, long
			// before the Canvas inside it is ready, so a scan after the timeout
			// would find a panel that is about to be torn down.
			const { service } = build({
				mainGroup,
				executeCommand: () => {
					canvasEditors.push(createCanvasEditor());
					return new DeferredPromise<undefined>().p;
				},
			});

			const entering = service.enter();
			await vi.advanceTimersByTimeAsync(20_000);

			expect(await entering).toMatchObject({ entered: false, reason: 'no-panel' });
		} finally {
			vi.useRealTimers();
		}
	});

	it('lets an exit stand that lands while the Canvas window is being created', async () => {
		const created = new DeferredPromise<IAuxiliaryEditorPart>();
		const mainGroup = createGroup([createCanvasEditor()]);
		const { service, auxiliaryPart, storageService, hideWindow } = build({
			mainGroup,
			createAuxiliaryEditorPart: () => created.p,
		});

		const entering = service.enter();
		// Window creation takes hundreds of milliseconds; the user asks for the
		// IDE back while it is still running.
		expect(await service.exit()).toBe(false);
		await created.complete(auxiliaryPart);

		// The entry must not resume into a window the user has since left: no
		// re-stored intent, no re-hidden IDE, and no reported entry.
		expect(await entering).toMatchObject({ entered: false });
		expect(storageService.store).not.toHaveBeenCalled();
		expect(hideWindow).not.toHaveBeenCalled();
		expect(service.isActive).toBe(false);
	});

	it('starts no Canvas work after an exit wins a pending engagement claim', async () => {
		const acquired = new DeferredPromise<boolean>();
		const { service, executeCommand, channelCall } = build({ acquireGranted: acquired.p });

		const entering = service.enter();
		await vi.waitFor(() => expect(channelCall).toHaveBeenCalledWith('acquire', expect.anything()));
		expect(await service.exit()).toBe(false);
		await acquired.complete(true);

		expect(await entering).toMatchObject({ entered: false, reason: 'superseded' });
		expect(executeCommand).not.toHaveBeenCalled();
		expect(channelCall).toHaveBeenCalledWith('release', expect.anything());
	});

	it('reports no-window when auxiliary window creation rejects', async () => {
		const mainGroup = createGroup([createCanvasEditor()]);
		const { service, hideWindow } = build({
			mainGroup,
			createAuxiliaryEditorPart: () => Promise.reject(new Error('window creation failed')),
		});

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-window' });
		expect(hideWindow).not.toHaveBeenCalled();
		expect(service.isActive).toBe(false);
	});

	it('merges Canvas back into the IDE when hiding the IDE fails', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, mainGroup, mergeGroup } = build({
			auxiliaryGroups: [auxiliaryGroup],
			hideWindow: () => Promise.reject(new Error('hide failed')),
		});

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-window' });

		expect(mergeGroup).toHaveBeenCalledWith(auxiliaryGroup, mainGroup);
		expect(auxiliaryGroup.lock).toHaveBeenNthCalledWith(1, true);
		expect(auxiliaryGroup.lock).toHaveBeenNthCalledWith(2, false);
		expect(service.isActive).toBe(false);
	});

	it('records the durable intent while it is presenting Canvas', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, storageService } = build({ auxiliaryGroups: [auxiliaryGroup] });

		await service.enter();

		expect(storageService.store).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, true, StorageScope.WORKSPACE, expect.anything());
		expect(service.isActive).toBe(true);
	});

	it('merges the Canvas group back into the IDE rather than closing it', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, mainGroup, mergeGroup, storageService } = build({ auxiliaryGroups: [auxiliaryGroup] });
		await service.enter();

		expect(await service.exit()).toBe(true);

		// Merging is what keeps the live conversation: closing an auxiliary part
		// destroys a webview panel instead of moving it.
		expect(mergeGroup).toHaveBeenCalledWith(auxiliaryGroup, mainGroup);
		expect(auxiliaryGroup.lock).toHaveBeenCalledWith(false);
		expect(storageService.remove).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
		expect(service.isActive).toBe(false);
	});

	it('reports an exit that had no Canvas to leave', async () => {
		const { service, mergeGroup, storageService, setPartHidden } = build();

		expect(await service.exit()).toBe(false);

		expect(mergeGroup).not.toHaveBeenCalled();
		// Nothing was undone, so nothing is redone: unhiding here would override
		// an editor area the user hid deliberately.
		expect(setPartHidden).not.toHaveBeenCalled();
		// Still cleared: exit means "I want the IDE" in every sense, including
		// what this workspace launches into next time.
		expect(storageService.remove).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('forgets the durable intent when the Canvas window goes away mid-session', async () => {
		const willDispose = new Emitter<void>();
		ctx.disposables.add(willDispose);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, storageService } = build({ auxiliaryGroups: [auxiliaryGroup], onWillDispose: willDispose.event });
		await service.enter();
		expect(service.isActive).toBe(true);

		willDispose.fire();

		expect(storageService.remove).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('keeps the durable intent when the window goes away because the app is quitting', async () => {
		const willDispose = new Emitter<void>();
		ctx.disposables.add(willDispose);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, storageService } = build({
			auxiliaryGroups: [auxiliaryGroup],
			onWillDispose: willDispose.event,
			willShutdown: true,
		});
		await service.enter();

		willDispose.fire();

		// Quitting in Canvas mode is exactly what "relaunch into Canvas" is made
		// of; clearing here would erase it.
		expect(storageService.remove).not.toHaveBeenCalled();
		expect(service.isActive).toBe(false);
	});

	it('reports engaged-elsewhere and asks the assistant for nothing when another window holds the claim', async () => {
		const { service, executeCommand, channelCall } = build({ acquireGranted: false });

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'engaged-elsewhere' });

		// A denied claim was never held, so there is nothing to release and
		// no Canvas work to have started.
		expect(executeCommand).not.toHaveBeenCalled();
		expect(channelCall).not.toHaveBeenCalledWith('release', expect.anything());
	});

	it('gives the claim back when the assistant produces no Canvas', async () => {
		const { service, channelCall } = build();

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-panel' });

		expect(channelCall).toHaveBeenCalledWith('acquire', expect.anything());
		expect(channelCall).toHaveBeenCalledWith('release', expect.anything());
	});

	it('holds the claim while presenting and gives it back on exit', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, channelCall } = build({ auxiliaryGroups: [auxiliaryGroup] });

		await service.enter();
		expect(channelCall).not.toHaveBeenCalledWith('release', expect.anything());

		expect(await service.exit()).toBe(true);
		expect(channelCall).toHaveBeenCalledWith('release', expect.anything());
	});

	it('does not report entry when the Canvas window dies while the IDE is being put away', async () => {
		const willDispose = new Emitter<void>();
		ctx.disposables.add(willDispose);
		const hide = new DeferredPromise<boolean>();
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, hideWindow, showWindow, focus } = build({
			auxiliaryGroups: [auxiliaryGroup],
			onWillDispose: willDispose.event,
			hideWindow: () => hide.p,
		});

		const entering = service.enter();
		await vi.waitFor(() => expect(hideWindow).toHaveBeenCalled());

		// The OS close button lands while the IDE hide is still in flight.
		willDispose.fire();
		await hide.complete(true);

		expect(await entering).toMatchObject({ entered: false, reason: 'superseded' });
		expect(service.isActive).toBe(false);
		// Whatever order the dying window's reveal and the hide settled
		// in, the user ends with a visible IDE.
		expect(showWindow).toHaveBeenCalled();
		expect(focus).toHaveBeenCalled();
	});

	it('moves the editors one by one when the merge back into the IDE fails', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, mergeGroup } = build({ auxiliaryGroups: [auxiliaryGroup] });
		await service.enter();

		mergeGroup.mockReturnValue(false);

		expect(await service.exit()).toBe(true);
		expect(auxiliaryGroup.moveEditors).toHaveBeenCalled();
	});

	it('starts a fresh entry for an enter() issued after an exit doomed the in-flight one', async () => {
		const mainGroup = createGroup([createCanvasEditor()]);
		const { service } = build({ mainGroup });

		const doomed = service.enter();
		await service.exit();

		// Coalescing onto the doomed promise would answer a request FOR
		// Canvas with "Positron was asked for the IDE".
		const outcome = await service.enter();

		expect(await doomed).toMatchObject({ entered: false, reason: 'superseded' });
		expect(outcome).toMatchObject({ entered: true });
	});

	it('forgets the durable intent when an entry fails to produce a Canvas', async () => {
		const { service, storageService } = build();

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-panel' });

		// A stored intent that keeps failing would boot every later launch
		// into the failure card.
		expect(storageService.remove).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('keeps the durable intent when another window already presents Canvas', async () => {
		const { service, storageService } = build({ acquireGranted: false });

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'engaged-elsewhere' });

		// The intent is shared per workspace; it belongs to the window that
		// won the engagement and is presenting Canvas.
		expect(storageService.remove).not.toHaveBeenCalled();
	});

	it('retries the reveal after a failed show left the IDE hidden', async () => {
		let showAttempts = 0;
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			showWindow: () => ++showAttempts === 1 ? Promise.reject(new Error('ipc dropped')) : Promise.resolve(),
		});
		await service.enter();

		// One rejected show must not convince the service the IDE is back: a
		// later exit has to try again, or no window is ever visible again.
		await expect(service.exit()).rejects.toThrow('ipc dropped');
		expect(await service.exit()).toBe(false);
		expect(showWindow).toHaveBeenCalledTimes(2);
	});

	it('releases the claim only after the exit revealed the IDE and merged Canvas back', async () => {
		const show = new DeferredPromise<void>();
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, channelCall, mergeGroup, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			showWindow: () => show.p,
		});
		await service.enter();

		const exiting = service.exit();
		await vi.waitFor(() => expect(showWindow).toHaveBeenCalled());

		// The main process reads the release as "exit complete" and lets a
		// waiting external open reuse this window; a release before the
		// reveal lands would let that open reload a still-hidden window.
		expect(channelCall).not.toHaveBeenCalledWith('release', expect.anything());
		expect(mergeGroup).not.toHaveBeenCalled();

		await show.complete();
		expect(await exiting).toBe(true);
		expect(mergeGroup).toHaveBeenCalled();
		expect(channelCall).toHaveBeenCalledWith('release', expect.anything());
	});

	it('lets a superseded entry settle without dropping the claim a newer entry re-acquired', async () => {
		const staleEnsure = new DeferredPromise<undefined>();
		const freshEnsure = new DeferredPromise<undefined>();
		let ensureCalls = 0;
		const canvasEditors: WebviewInput[] = [];
		const auxiliaryGroup = createGroup(canvasEditors);
		const { service, executeCommand, channelCall } = build({
			auxiliaryGroups: [auxiliaryGroup],
			executeCommand: () => ++ensureCalls === 1 ? staleEnsure.p : freshEnsure.p,
		});

		const doomed = service.enter();
		await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(1));
		await service.exit();
		const fresh = service.enter();
		await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledTimes(2));

		// The doomed attempt settles first, while the fresh entry holds the
		// claim but is still waiting on the assistant.
		await staleEnsure.complete(undefined);
		expect(await doomed).toMatchObject({ entered: false, reason: 'superseded' });

		canvasEditors.push(createCanvasEditor());
		await freshEnsure.complete(undefined);
		expect(await fresh).toEqual({ entered: true });

		// One release, from the exit: the doomed attempt settling must not
		// give back the claim the fresh entry presents Canvas under.
		expect(channelCall.mock.calls.filter(([command]) => command === 'release')).toHaveLength(1);
	});

	it('does not force the IDE back over a newer entry when a superseded hide settles', async () => {
		const staleHide = new DeferredPromise<boolean>();
		let hideCalls = 0;
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, hideWindow, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			hideWindow: () => ++hideCalls === 1 ? staleHide.p : Promise.resolve(true),
		});

		const doomed = service.enter();
		await vi.waitFor(() => expect(hideWindow).toHaveBeenCalledTimes(1));
		// The user exits (revealing the IDE) and immediately re-enters.
		await service.exit();
		expect(await service.enter()).toEqual({ entered: true });

		// The doomed attempt's hide settles only now; a forced reveal here
		// would put the IDE on top of the Canvas the new entry presents.
		await staleHide.complete(true);
		expect(await doomed).toMatchObject({ entered: false, reason: 'superseded' });
		expect(showWindow).toHaveBeenCalledTimes(1);
		expect(service.isActive).toBe(true);
	});

	it('hides detached editor windows with the IDE and re-shows them on exit', async () => {
		const detachedPart = createPart(createGroup(), Event.None, DETACHED_WINDOW_ID);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, hideWindow, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			extraParts: [detachedPart],
		});

		expect(await service.enter()).toEqual({ entered: true });
		// Canvas is the sole surface: the detached window goes away with the
		// IDE; the Canvas window itself is never hidden.
		expect(hideWindow).toHaveBeenCalledWith({ targetWindowId: DETACHED_WINDOW_ID });
		expect(hideWindow).not.toHaveBeenCalledWith({ targetWindowId: AUX_WINDOW_ID });

		expect(await service.exit()).toBe(true);
		expect(showWindow).toHaveBeenCalledWith({ targetWindowId: mainWindow.vscodeWindowId });
		expect(showWindow).toHaveBeenCalledWith({ targetWindowId: DETACHED_WINDOW_ID });
	});

	it('finishes every hide before a failed hide starts the unwind', async () => {
		const detachedHide = new DeferredPromise<boolean>();
		let hideCalls = 0;
		const detachedPart = createPart(createGroup(), Event.None, DETACHED_WINDOW_ID);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, hideWindow, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			extraParts: [detachedPart],
			hideWindow: () => ++hideCalls === 1 ? Promise.reject(new Error('hide failed')) : detachedHide.p,
		});

		const entering = service.enter();
		await vi.waitFor(() => expect(hideWindow).toHaveBeenCalledTimes(2));
		await new Promise(resolve => setTimeout(resolve, 0));

		// The IDE hide already failed, but an unwind revealing windows while
		// the detached window's hide is still in flight would let that hide
		// land after its re-show, leaving the window hidden for good.
		expect(showWindow).not.toHaveBeenCalled();

		await detachedHide.complete(true);
		expect(await entering).toMatchObject({ entered: false, reason: 'no-window' });
		expect(showWindow).toHaveBeenCalledWith({ targetWindowId: DETACHED_WINDOW_ID });
	});

	it('queues an enter issued during an exit until the exit has finished', async () => {
		const show = new DeferredPromise<void>();
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, executeCommand, mergeGroup, showWindow, channelCall } = build({
			auxiliaryGroups: [auxiliaryGroup],
			showWindow: () => show.p,
		});
		await service.enter();

		const exiting = service.exit();
		await vi.waitFor(() => expect(showWindow).toHaveBeenCalled());

		const entering = service.enter();
		await new Promise(resolve => setTimeout(resolve, 0));

		// The queued entry must not have started Canvas work the exit's merge
		// would yank apart, nor hold an engagement the exit's finally releases.
		expect(executeCommand).toHaveBeenCalledTimes(1);
		expect(mergeGroup).not.toHaveBeenCalled();

		await show.complete();
		expect(await exiting).toBe(true);
		expect(await entering).toEqual({ entered: true });
		expect(service.isActive).toBe(true);
		// One release, from the exit: the entry it queued presents Canvas
		// under a claim of its own.
		expect(channelCall.mock.calls.filter(([command]) => command === 'release')).toHaveLength(1);
	});

	it('coalesces a second exit onto the one in flight instead of replacing it', async () => {
		const show = new DeferredPromise<void>();
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			showWindow: () => show.p,
		});
		await service.enter();

		const first = service.exit();
		await vi.waitFor(() => expect(showWindow).toHaveBeenCalled());
		const second = service.exit();

		// The same transaction: a second exit of its own could settle first
		// and free `enter()` while this one still owns the captured group.
		expect(second).toBe(first);

		await show.complete();
		expect(await first).toBe(true);
	});

	it('still merges Canvas back when re-showing a detached window fails', async () => {
		let showCalls = 0;
		const detachedPart = createPart(createGroup(), Event.None, DETACHED_WINDOW_ID);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, mergeGroup, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			extraParts: [detachedPart],
			showWindow: () => ++showCalls === 2 ? Promise.reject(new Error('ipc dropped')) : Promise.resolve(),
		});
		await service.enter();

		// The detached window's show (the second) rejects; an exit aborting
		// there would strand the live Canvas in its chromeless window with
		// the mode already off.
		expect(await service.exit()).toBe(true);
		expect(mergeGroup).toHaveBeenCalled();

		// Still recorded, so the next reveal retries the failed show.
		expect(await service.exit()).toBe(false);
		expect(showWindow.mock.calls.filter(([options]) => options?.targetWindowId === DETACHED_WINDOW_ID)).toHaveLength(2);
	});

	it('does not re-show a detached window it did not hide', async () => {
		const detachedPart = createPart(createGroup(), Event.None, DETACHED_WINDOW_ID);
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, showWindow } = build({
			auxiliaryGroups: [auxiliaryGroup],
			extraParts: [detachedPart],
			// The user had already hidden or minimized the detached window;
			// the main process reports it left it untouched.
			hideWindow: options => Promise.resolve(options?.targetWindowId !== DETACHED_WINDOW_ID),
		});

		expect(await service.enter()).toEqual({ entered: true });
		expect(await service.exit()).toBe(true);

		expect(showWindow).toHaveBeenCalledWith({ targetWindowId: mainWindow.vscodeWindowId });
		expect(showWindow).not.toHaveBeenCalledWith({ targetWindowId: DETACHED_WINDOW_ID });
	});

	it('forgets the durable intent when an entry rejects outright', async () => {
		const mainGroup = createGroup([createCanvasEditor()]);
		vi.mocked(mainGroup.moveEditors).mockImplementation(() => { throw new Error('move failed'); });
		const { service, storageService } = build({ mainGroup });

		await expect(service.enter()).rejects.toThrow('move failed');

		// Quitting from the generic failure card must not preserve an intent
		// that boots the next launch straight back into the failing curtain.
		expect(storageService.remove).toHaveBeenCalledWith(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('keeps the durable intent when an entry rejects while the app is quitting', async () => {
		const mainGroup = createGroup([createCanvasEditor()]);
		vi.mocked(mainGroup.moveEditors).mockImplementation(() => { throw new Error('move failed'); });
		const { service, storageService } = build({ mainGroup, willShutdown: true });

		await expect(service.enter()).rejects.toThrow('move failed');

		// A teardown rejection during a quit in Canvas must not erase the
		// "quit in Canvas, relaunch into Canvas" record.
		expect(storageService.remove).not.toHaveBeenCalled();
	});

	it('moves a Canvas the user detached into a plain window into a dedicated one', async () => {
		const plainGroup = createGroup([createCanvasEditor()]);
		const { service, createAuxiliaryEditorPart } = build({
			auxiliaryGroups: [plainGroup],
			plainAuxWindows: true,
		});

		expect(await service.enter()).toEqual({ entered: true });

		// A window without the locked-compact trait is not a dedicated Canvas
		// window -- the user detached the panel with an ordinary move -- so
		// the panel gets a fresh dedicated window instead of being adopted.
		expect(createAuxiliaryEditorPart).toHaveBeenCalledWith(expect.objectContaining({ lockCompact: true }));
		expect(plainGroup.moveEditors).toHaveBeenCalled();
	});
});
