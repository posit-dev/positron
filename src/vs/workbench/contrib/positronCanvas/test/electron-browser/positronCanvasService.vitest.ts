/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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

	function createPart(activeGroup: IEditorGroup, onWillDispose: Event<void> = Event.None): IAuxiliaryEditorPart {
		return stubInterface<IAuxiliaryEditorPart>({ activeGroup, onWillDispose, close: vi.fn() });
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
		willShutdown?: boolean;
		onWillDispose?: Event<void>;
		executeCommand?: () => Promise<undefined>;
		createAuxiliaryEditorPart?: IEditorGroupsService['createAuxiliaryEditorPart'];
		acquireGranted?: boolean | Promise<boolean>;
		minimizeWindow?: () => Promise<void>;
	} = {}) {
		const auxiliaryGroups = options.auxiliaryGroups ?? [];
		const mainGroup = options.mainGroup ?? createGroup();
		const mainPart = createPart(mainGroup);
		const auxiliaryGroup = auxiliaryGroups.at(0);
		const auxiliaryPart = createPart(auxiliaryGroup ?? createGroup(), options.onWillDispose ?? Event.None);

		const parts = new Map<IEditorGroup, IEditorPart>(auxiliaryGroups.map(group => [group, auxiliaryPart]));
		parts.set(mainGroup, mainPart);

		const executeCommand = vi.fn(options.executeCommand ?? (() => Promise.resolve(undefined)));
		const storageService = stubInterface<IStorageService>({ store: vi.fn(), remove: vi.fn() });
		const mergeGroup = vi.fn().mockReturnValue(true);
		const setPartHidden = vi.fn();
		const minimizeWindow = vi.fn(options.minimizeWindow ?? (() => Promise.resolve()));
		const createAuxiliaryEditorPart = vi.fn(options.createAuxiliaryEditorPart ?? (() => Promise.resolve(auxiliaryPart)));

		ctx.instantiationService.stub(IEditorGroupsService, stubInterface<IEditorGroupsService>({
			mainPart,
			getGroups: () => [...auxiliaryGroups, mainGroup],
			getPart: (group: IEditorGroup) => parts.get(group) ?? mainPart,
			mergeGroup,
			createAuxiliaryEditorPart,
		}));
		ctx.instantiationService.stub(ICommandService, stubInterface<ICommandService>({ executeCommand }));
		ctx.instantiationService.stub(IConfigurationService, stubInterface<IConfigurationService>({ getValue: () => true }));
		ctx.instantiationService.stub(INativeHostService, stubInterface<INativeHostService>({ minimizeWindow }));
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

		return { service, mainGroup, auxiliaryPart, executeCommand, storageService, mergeGroup, setPartHidden, minimizeWindow, channelCall, focus };
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
		const { service, executeCommand, minimizeWindow } = build({
			mainGroup,
			executeCommand: () => Promise.reject(new Error('command not found')),
		});

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-panel' });

		expect(executeCommand).toHaveBeenCalledWith(CANVAS_ENSURE_COMMAND);
		expect(minimizeWindow).not.toHaveBeenCalled();
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
		const { service, auxiliaryPart, storageService, minimizeWindow } = build({
			mainGroup,
			createAuxiliaryEditorPart: () => created.p,
		});

		const entering = service.enter();
		// Window creation takes hundreds of milliseconds; the user asks for the
		// IDE back while it is still running.
		expect(await service.exit()).toBe(false);
		await created.complete(auxiliaryPart);

		// The entry must not resume into a window the user has since left: no
		// re-stored intent, no re-minimized IDE, and no reported entry.
		expect(await entering).toMatchObject({ entered: false });
		expect(storageService.store).not.toHaveBeenCalled();
		expect(minimizeWindow).not.toHaveBeenCalled();
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
		const { service, minimizeWindow } = build({
			mainGroup,
			createAuxiliaryEditorPart: () => Promise.reject(new Error('window creation failed')),
		});

		expect(await service.enter()).toMatchObject({ entered: false, reason: 'no-window' });
		expect(minimizeWindow).not.toHaveBeenCalled();
		expect(service.isActive).toBe(false);
	});

	it('merges Canvas back into the IDE when minimizing the IDE fails', async () => {
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, mainGroup, mergeGroup } = build({
			auxiliaryGroups: [auxiliaryGroup],
			minimizeWindow: () => Promise.reject(new Error('minimize failed')),
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
		const minimize = new DeferredPromise<void>();
		const auxiliaryGroup = createGroup([createCanvasEditor()]);
		const { service, minimizeWindow, focus } = build({
			auxiliaryGroups: [auxiliaryGroup],
			onWillDispose: willDispose.event,
			minimizeWindow: () => minimize.p,
		});

		const entering = service.enter();
		await vi.waitFor(() => expect(minimizeWindow).toHaveBeenCalled());

		// The OS close button lands while the IDE minimize is still in flight.
		willDispose.fire();
		await minimize.complete();

		expect(await entering).toMatchObject({ entered: false, reason: 'superseded' });
		expect(service.isActive).toBe(false);
		// Whatever order the dying window's reveal and the minimize settled
		// in, the user ends with a visible IDE.
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
});
