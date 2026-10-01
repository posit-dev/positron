/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { POSITRON_STANDALONE_MODE_CHANNEL_NAME } from '../../../../platform/positronStandaloneMode/common/positronStandaloneMode.js';
import { PositronStandaloneModeChannelClient } from '../../../../platform/positronStandaloneMode/common/positronStandaloneModeIpc.js';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from '../../../../platform/storage/common/storage.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart, GroupsOrder } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService, ShutdownReason } from '../../../services/lifecycle/common/lifecycle.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { dedicatedWindowOptions } from '../../positronEditorActions/browser/positronDedicatedWindow.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { createCanvasLoadingCurtain } from '../browser/canvasStartupPresenter.js';
import { mergeCanvasGroupIntoIde } from '../browser/positronCanvasRestore.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE, CanvasEntryOutcome, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/** Posit Assistant's command to open a Canvas panel as an ordinary editor. */
const CANVAS_ENSURE_COMMAND = 'posit-assistant.ensureCanvas';

/**
 * Cap on waiting for the assistant to produce a panel: the command settles
 * within the assistant's own 14s ensure deadline, so this only adds headroom
 * for extension activation (which `executeCommand` blocks on unboundedly).
 */
const CANVAS_ENSURE_TIMEOUT = 20_000;

/** The outcome of an entry retired because a newer exit request won. */
const supersededOutcome: CanvasEntryOutcome = {
	entered: false,
	reason: 'superseded',
	message: localize('positron.canvas.superseded', "Canvas stopped opening because Positron was asked for the IDE.")
};

export const IPositronCanvasService = createDecorator<IPositronCanvasService>('positronCanvasService');

export interface IPositronCanvasService {

	readonly _serviceBrand: undefined;

	/**
	 * Present Canvas as the whole product: one conversation in a standalone
	 * window, IDE window out of the way. Resolves an outcome rather than
	 * throwing for known non-entry cases, because presentation belongs to the
	 * caller (startup curtain, palette notification, or the assistant).
	 */
	enter(): Promise<CanvasEntryOutcome>;

	/** Whether Canvas is currently the only surface the user can see. */
	readonly isActive: boolean;

	/**
	 * Hand the user back to the full IDE, moving the live conversation into
	 * it. Resolves `true` only when it actually left Canvas mode.
	 */
	exit(): Promise<boolean>;

	/**
	 * Presents "Canvas is loading another folder" while `open` runs. `open`
	 * prepares this window and then asks the main process to load the other
	 * folder into it through the ordinary open path; this method owns what
	 * the user sees around that. Curtains go up over Canvas and the IDE, the
	 * covered IDE window is shown and the Canvas window put away, then `open`
	 * runs. Once the load is accepted this window's document goes away with
	 * the curtains still up, and the stored Canvas intent for the folder
	 * being left is cleared inside the shutdown state save so the old folder
	 * relaunches into the IDE. If `open` rejects while this window is still
	 * alive, Canvas is brought back exactly as it was and the rejection is
	 * passed on. Resolves when the load is under way; the caller cannot await
	 * Canvas readiness in the new folder.
	 *
	 * `open` receives `stillPresenting`: whether the Canvas this request
	 * started from is still the one on screen. It turns false on exit, on a
	 * native close, and stays false across an exit followed by a re-entry
	 * (`isActive` would read true again), so preparation checks it after
	 * every await and stops rather than loading a folder into a Canvas the
	 * user has since left and re-opened.
	 */
	openFolderWithLoadingPresentation(open: (stillPresenting: () => boolean) => Promise<void>): Promise<void>;

	/**
	 * Puts away an auxiliary window that layout restore brought back while
	 * this window boots into Canvas. Restore recreates the workspace's
	 * detached windows natively visible, and the startup curtain covers only
	 * the main window, so a floating editor would sit on screen before Canvas
	 * is up. A held window is treated like any window Canvas mode puts away:
	 * entry shows it if it becomes the Canvas window, exit and startup
	 * recovery re-show it otherwise.
	 */
	holdRestoredWindow(windowId: number): Promise<void>;
}

/** A Canvas panel and the group it currently lives in. */
interface ICanvasEditor {
	readonly group: IEditorGroup;
	readonly editor: WebviewInput;
}

export class PositronCanvasService extends Disposable implements IPositronCanvasService {

	declare readonly _serviceBrand: undefined;

	private readonly modeActiveContext: IContextKey<boolean>;

	/**
	 * Where the main process hears about the engagement; see
	 * `IPositronStandaloneModeMainService`.
	 */
	private readonly standaloneModeChannel: PositronStandaloneModeChannelClient;

	/** Whether this window holds the application-wide claim. */
	private engagementHeld = false;

	/**
	 * The window presenting Canvas, plus everything to undo when it stops.
	 * Disposing the store is the whole teardown.
	 */
	private readonly canvasWindow = this._register(new MutableDisposable<DisposableStore>());
	private canvasGroup: IEditorGroup | undefined;

	/** Set while the IDE window has been put away on Canvas's behalf. */
	private ideWindowHidden = false;

	/**
	 * Auxiliary editor windows put away on Canvas's behalf, so exit re-shows
	 * exactly these and never a window the user put away some other way.
	 */
	private readonly hiddenAuxWindowIds = new Set<number>();

	/** In-flight `enter()`; concurrent callers coalesce onto it. */
	private entering: Promise<CanvasEntryOutcome> | undefined;

	/**
	 * In-flight `exit()`. An entry starting inside an exit would adopt the
	 * group the exit's merge is about to yank back, so `doEnter()` waits
	 * this out first.
	 */
	private exiting: Promise<boolean> | undefined;

	/**
	 * Identity of the newest entry attempt. An exit detaches an in-flight
	 * entry rather than waiting for it; only the newest attempt may release
	 * the engagement or move windows around on its way out.
	 */
	private currentEntryAttempt: object | undefined;

	/**
	 * Bumped by every `exit()`. An entry that resumes after an exit landed
	 * inside it would silently undo the exit, so `doEnter()` captures the
	 * count and rechecks it after each await.
	 */
	private exitGeneration = 0;

	/** In-flight `openFolderWithLoadingPresentation()`; one at a time. */
	private folderOpen: Promise<void> | undefined;

	/**
	 * The shutdown bookkeeping of an accepted folder open. Kept until this
	 * document goes away with the load; cleared when the open fails live.
	 */
	private readonly folderOpenShutdownListeners = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IHostService private readonly hostService: IHostService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		super();

		this.modeActiveContext = PositronCanvasModeActiveContext.bindTo(contextKeyService);
		this.standaloneModeChannel = new PositronStandaloneModeChannelClient(mainProcessService.getChannel(POSITRON_STANDALONE_MODE_CHANNEL_NAME));
	}

	/**
	 * Claim the application-wide engagement before any entry work. The main
	 * process decides atomically; idempotent for the holder, which keeps
	 * re-entry legitimate.
	 */
	private async acquireEngagement(): Promise<boolean> {
		try {
			// The exit command travels with the claim, so the main process can
			// ask Canvas to stand down without knowing about Canvas.
			const granted = await this.standaloneModeChannel.acquire(mainWindow.vscodeWindowId, CANVAS_EXIT_COMMAND_ID);
			this.engagementHeld = this.engagementHeld || granted;
			return granted;
		} catch (error) {
			// Losing the channel loses the cross-window guarantee, not the
			// ability to present Canvas in this window.
			this.logService.error('[canvas] Could not claim Canvas mode with the main process; continuing', error);
			return true;
		}
	}

	/**
	 * Give the claim back. Fire-and-forget: failing to say so must not fail
	 * the exit it rode along with.
	 */
	private releaseEngagement(): void {
		if (!this.engagementHeld) {
			return;
		}
		this.engagementHeld = false;
		this.standaloneModeChannel.release(mainWindow.vscodeWindowId)
			.catch(error => this.logService.error('[canvas] Could not release Canvas mode with the main process', error));
	}

	enter(): Promise<CanvasEntryOutcome> {
		if (!this.entering) {
			const entering = this.doEnter().then(outcome => {
				// A failed entry means Canvas is not on screen; leaving the
				// stored intent set would boot every later launch into the
				// failure card. 'superseded' keeps it (during shutdown it is
				// the "quit in Canvas" record; an explicit exit already
				// cleared it), as does 'engaged-elsewhere' (it belongs to the
				// window presenting this workspace's Canvas).
				if (!outcome.entered && outcome.reason !== 'superseded' && outcome.reason !== 'engaged-elsewhere') {
					this.setCanvasModeIntent(false);
				}
				return outcome;
			}, error => {
				// Same for a rejected entry, except during a quit in Canvas:
				// a teardown rejection must not erase the quit record.
				if (!this.lifecycleService.willShutdown) {
					this.setCanvasModeIntent(false);
				}
				throw error;
			}).finally(() => {
				// Guarded: `exit()` detaches a doomed in-flight entry, and
				// this must not wipe out a fresh entry started since.
				if (this.entering === entering) {
					this.entering = undefined;
				}
			});
			this.entering = entering;
		}
		return this.entering;
	}

	private async doEnter(): Promise<CanvasEntryOutcome> {
		// Wait out an in-flight exit, but only an exit arriving after this
		// call may retire the entry: capture the generation synchronously,
		// past the in-flight exit's bump. No deadlock: exit never awaits an
		// entry, and the hide-failure exit inside `doEnterEngaged` starts
		// while this entry is already past this point.
		const generationAtRequest = this.exitGeneration;
		while (this.exiting) {
			await this.exiting.catch(() => { });
		}
		if (this.exitGeneration !== generationAtRequest) {
			this.logService.info('[canvas] Abandoning entry: the user asked for the IDE again while the entry was queued behind an exit');
			return supersededOutcome;
		}

		// Read live: `ai.enabled` toggles without a reload.
		if (this.configurationService.getValue<boolean>(AI_ENABLED_KEY) === false) {
			this.logService.info('[canvas] Not entering Canvas mode: ai.enabled is false');
			return {
				entered: false,
				reason: 'ai-disabled',
				message: localize('positron.canvas.aiDisabled', "Canvas is unavailable because AI features are disabled.")
			};
		}

		// Captured before the claim's await so an exit arriving mid-claim
		// supersedes this entry like any other.
		const generation = this.exitGeneration;
		const attempt = {};
		this.currentEntryAttempt = attempt;

		if (!await this.acquireEngagement()) {
			return {
				entered: false,
				reason: 'engaged-elsewhere',
				message: localize('positron.canvas.engagedElsewhere', "Canvas is already open in another Positron window.")
			};
		}

		try {
			return await this.doEnterEngaged(generation, attempt);
		} finally {
			// Token-guarded: a superseded attempt settling here must not give
			// back the claim a newer entry has re-acquired. Presenting keeps
			// the claim: a failed re-entry must not drop the live Canvas's.
			if (this.currentEntryAttempt === attempt && this.canvasWindow.value === undefined) {
				this.releaseEngagement();
			}
		}
	}

	private async doEnterEngaged(generation: number, attempt: object): Promise<CanvasEntryOutcome> {
		const superseded = () => this.exitGeneration !== generation;
		if (superseded()) {
			this.logService.info('[canvas] Abandoning entry: the user left Canvas while the application-wide claim was pending');
			return supersededOutcome;
		}

		const canvas = await this.ensureCanvasEditor();
		if (superseded()) {
			this.logService.info('[canvas] Abandoning entry: the user left Canvas while it was opening');
			return supersededOutcome;
		}
		if (!canvas) {
			return {
				entered: false,
				reason: 'no-panel',
				message: localize('positron.canvas.couldNotOpen', "Canvas could not be opened. Check the Posit Assistant output for details.")
			};
		}

		// A panel in the IDE window, or one the user dragged into a plain
		// auxiliary window, moves into a fresh dedicated window.
		const part = this.editorGroupsService.getPart(canvas.group);
		const canvasWindow = this.isDedicatedCanvasWindow(part)
			? { part, group: canvas.group }
			: await this.promoteToCanvasWindow(canvas, superseded);

		if (superseded()) {
			this.logService.info('[canvas] Abandoning entry: the user left Canvas while its window was being created');
			return supersededOutcome;
		}

		if (!canvasWindow) {
			return {
				entered: false,
				reason: 'no-window',
				message: localize('positron.canvas.couldNotOpenWindow', "Canvas could not be opened in its own window.")
			};
		}

		this.adoptCanvasWindow(canvasWindow.part, canvasWindow.group);

		// Only now, with a live Canvas window on screen, is it safe to put
		// the IDE window away.
		try {
			await this.hideIdeWindow(canvasWindow.part.windowId);
		} catch (error) {
			this.logService.error('[canvas] Could not put the IDE window away; leaving Canvas mode', error);
			if (this.currentEntryAttempt !== attempt) {
				// A newer entry owns the windows now.
				return supersededOutcome;
			}
			// A committed entry over a failed hide is not recoverable; run
			// the normal merge-back transaction.
			await this.exit();
			return {
				entered: false,
				reason: 'no-window',
				message: localize('positron.canvas.couldNotHideIde', "Canvas could not take over from the Positron window.")
			};
		}

		if (superseded()) {
			this.logService.info('[canvas] Abandoning entry: Canvas went away while the IDE window was being put away');
			// The exit's reveal may have raced the hide in flight here;
			// reveal unconditionally, unless a newer entry started since and
			// may have hidden the IDE again.
			if (this.currentEntryAttempt === attempt) {
				await this.revealIdeWindow(true);
			}
			return supersededOutcome;
		}

		return { entered: true };
	}

	get isActive(): boolean {
		return this.modeActiveContext.get() === true;
	}

	exit(): Promise<boolean> {
		// Coalesce onto the exit in flight. Still an operative "I want the
		// IDE": like `doExit()`, retire and detach any entry queued behind
		// the in-flight exit so a later `enter()` starts fresh.
		if (this.exiting) {
			this.exitGeneration++;
			this.entering = undefined;
			return this.exiting;
		}
		// `doExit()` runs synchronously up to its first await, so the
		// generation bump and entry detach land before any caller resumes.
		this.exiting = this.doExit().finally(() => {
			this.exiting = undefined;
		});
		return this.exiting;
	}

	private async doExit(): Promise<boolean> {
		this.logService.info(`[canvas] Exiting Canvas mode (${this.canvasWindow.value !== undefined ? 'presenting' : 'not presenting'})`);

		// Retire any entry still in flight and detach it so a later `enter()`
		// starts fresh instead of coalescing onto a doomed promise.
		this.exitGeneration++;
		this.entering = undefined;

		const canvasGroup = this.canvasGroup;

		// Read before `stopPresenting()`, which is what makes it false.
		const wasActive = this.canvasWindow.value !== undefined;

		// Unconditional: exit means "I want the IDE" in every sense,
		// including what this workspace launches into next time.
		this.setCanvasModeIntent(false);

		// Stop presenting first: it drops the listener that treats the Canvas
		// window going away as something to recover from.
		this.stopPresenting();

		try {
			// Show the IDE before moving anything into it: the move focuses
			// its target, and focusing a group in an off-screen window leaves
			// the user with no visible focused window.
			await this.revealIdeWindow();

			if (canvasGroup) {
				mergeCanvasGroupIntoIde(canvasGroup, this.editorGroupsService.mainPart.activeGroup, this.editorGroupsService, this.logService);

				// The editor area auto-hides when its last editor leaves.
				// Only when the merge happened: an exit with nothing to merge
				// must not override an editor area the user hid deliberately.
				this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
				this.editorGroupsService.mainPart.activeGroup.focus();
			}
		} finally {
			// Released only after the reveal and merge: the main process
			// treats the release as "exit complete" and lets a waiting
			// external open reuse this window, which must not still be
			// hidden. On every path, so an exit landing inside an in-flight
			// entry does not leave the early claim behind.
			this.releaseEngagement();
		}

		return wasActive;
	}

	openFolderWithLoadingPresentation(open: (stillPresenting: () => boolean) => Promise<void>): Promise<void> {
		if (this.folderOpen) {
			return Promise.reject(new Error(localize('positron.canvas.switchInProgress', "Canvas is already switching folders.")));
		}
		this.folderOpen = this.doOpenFolder(open).finally(() => {
			this.folderOpen = undefined;
		});
		return this.folderOpen;
	}

	private async doOpenFolder(open: (stillPresenting: () => boolean) => Promise<void>): Promise<void> {
		// Serialize behind an entry or exit in flight: their window moves
		// and this one's must not interleave.
		while (this.entering || this.exiting) {
			await (this.entering ?? this.exiting)?.then(() => { }, () => { });
		}
		const group = this.canvasGroup;
		if (this.canvasWindow.value === undefined || !group) {
			throw new Error(localize('positron.canvas.switchNotPresenting', "Canvas is not open in its own window."));
		}
		if (this.lifecycleService.willShutdown) {
			throw new Error(localize('positron.canvas.switchShuttingDown', "Positron is shutting down."));
		}

		const generation = this.exitGeneration;
		const stillPresenting = () => this.exitGeneration === generation && this.canvasWindow.value !== undefined;
		const cancelled = () => new Error(localize('positron.canvas.switchCancelled', "Canvas was closed while switching folders."));
		const canvasPart = this.editorGroupsService.getPart(group);
		const canvasContainer = this.auxiliaryWindowService.getWindow(canvasPart.windowId)?.container;
		const message = localize('positron.canvas.switchLoading', "Canvas is opening another folder...");

		// Curtains first, before any window is shown: the Canvas window (what
		// the user is looking at) and the IDE window the load will reveal.
		const curtains = new DisposableStore();
		if (canvasContainer) {
			curtains.add(createCanvasLoadingCurtain(canvasContainer, message));
		}
		curtains.add(createCanvasLoadingCurtain(this.layoutService.mainContainer, message));

		// The stored Canvas intent belongs to the folder being left. It is
		// removed inside the accepted shutdown's state save, and only for a
		// LOAD: a veto saves nothing, a Quit or Close in Canvas must keep the
		// "relaunch into Canvas" record, and an ordinary flush is not a
		// shutdown. `onBeforeShutdown` fires before the save; `onWillShutdown`
		// would fire after the storage service's own listener has saved.
		const listeners = new DisposableStore();
		let shutdownReason: ShutdownReason | undefined;
		listeners.add(this.lifecycleService.onBeforeShutdown(e => { shutdownReason = e.reason; }));
		listeners.add(this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN && shutdownReason === ShutdownReason.LOAD) {
				this.logService.info('[canvas] Leaving this folder for another one; it will relaunch into the IDE');
				this.storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
			}
		}));
		this.folderOpenShutdownListeners.value = listeners;

		let ideShown = false;
		try {
			// The ordinary open focuses the target window early. Show it now,
			// covered, and put Canvas away only once that landed, so there is
			// always a visible window.
			await this.nativeHostService.showWindow({ targetWindowId: mainWindow.vscodeWindowId });
			this.ideWindowHidden = false;
			ideShown = true;
			if (!stillPresenting()) {
				throw cancelled();
			}
			try {
				await this.nativeHostService.hideWindow({ targetWindowId: canvasPart.windowId });
			} catch (error) {
				// Two covered windows beat an invisible application.
				this.logService.error('[canvas] Could not put the Canvas window away for the folder open; continuing', error);
			}
			if (!stillPresenting()) {
				throw cancelled();
			}

			await open(stillPresenting);

			// Accepted: this document is on its way out. The curtains stay up
			// until it goes; nothing here waits for the new folder.
			this.logService.info('[canvas] The folder open was accepted; this window is loading the other folder');
			this._register(curtains);
		} catch (error) {
			if (this.lifecycleService.willShutdown) {
				// Shutdown is under way (the accepted load, or a quit that
				// arrived meanwhile); the document is going, restore nothing.
				this._register(curtains);
				throw error;
			}
			this.folderOpenShutdownListeners.clear();
			await this.restoreAfterFailedFolderOpen(ideShown, canvasPart.windowId, group, curtains, stillPresenting);
			throw error;
		}
	}

	/**
	 * Puts things back after a folder open failed with this window alive:
	 * Canvas window back, IDE window away *before* its curtain comes down.
	 * Ownership is read live: Canvas can be closed, exited, or the app quit
	 * while each native call is in flight, and the window loss / exit path
	 * that runs then owns the IDE window from that point. When Canvas is
	 * gone, only the covers come off; when it went while the IDE was being
	 * hidden, that hide is undone so a window survives; during a shutdown
	 * nothing is touched and the covers stay up.
	 */
	private async restoreAfterFailedFolderOpen(ideShown: boolean, canvasWindowId: number, group: IEditorGroup, curtains: DisposableStore, stillPresenting: () => boolean): Promise<void> {
		const shuttingDown = () => this.lifecycleService.willShutdown;
		try {
			if (stillPresenting()) {
				// Showing a window that no longer exists resolves too; the
				// predicate, not the resolved show, says whether Canvas is back.
				await this.nativeHostService.showWindow({ targetWindowId: canvasWindowId });
			}
			if (ideShown && !shuttingDown() && stillPresenting()) {
				const hidden = await this.nativeHostService.hideWindow({ targetWindowId: mainWindow.vscodeWindowId });
				if (shuttingDown()) {
					// The quit's teardown owns the windows now.
				} else if (stillPresenting()) {
					// `false` means the IDE window was already away or the hide
					// was abandoned; only a hide this call made is ours to undo.
					this.ideWindowHidden = hidden || this.ideWindowHidden;
				} else if (hidden) {
					// Canvas went away while the IDE was being put away, and its
					// own reveal ran while the IDE was still visible: this hide
					// took the only surviving window with it.
					this.logService.info('[canvas] Canvas closed while the IDE was being put away after a failed folder open; showing the IDE again');
					await this.nativeHostService.showWindow({ targetWindowId: mainWindow.vscodeWindowId });
					this.ideWindowHidden = false;
				}
			}
		} catch (error) {
			// Whatever is visible stays visible.
			this.logService.error('[canvas] Could not restore the Canvas window after the folder open failed', error);
		}
		if (shuttingDown()) {
			this._register(curtains);
			return;
		}
		curtains.dispose();
		if (stillPresenting()) {
			group.focus();
		}
	}

	/**
	 * The most recently active Canvas panel anywhere in the workbench.
	 * The assistant's ensure command owns singleton-ness; this scan only finds
	 * the ready panel that command selected or created.
	 */
	private findCanvasEditor(): ICanvasEditor | undefined {
		const found: ICanvasEditor[] = [];

		for (const group of this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			for (const editor of group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
				if (editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE) {
					found.push({ group, editor });
				}
			}
		}

		if (found.length > 1) {
			// Non-destructive on purpose: closing the extras would dispose
			// live assistant sessions.
			this.logService.warn(`[canvas] ${found.length} Canvas panels are open; presenting the most recently active one`);
		}

		return found.at(0);
	}

	private async ensureCanvasEditor(): Promise<ICanvasEditor | undefined> {
		// `raceTimeout` resolves undefined on timeout and on completion (the
		// command always resolves undefined); only the callback tells them apart.
		let timedOut = false;

		try {
			await raceTimeout(
				this.commandService.executeCommand(CANVAS_ENSURE_COMMAND),
				CANVAS_ENSURE_TIMEOUT,
				() => {
					timedOut = true;
					this.logService.error(`[canvas] ${CANVAS_ENSURE_COMMAND} did not complete within ${CANVAS_ENSURE_TIMEOUT}ms`);
				}
			);
		} catch (error) {
			this.logService.error(`[canvas] ${CANVAS_ENSURE_COMMAND} failed`, error);
			return undefined;
		}

		// A timeout is a failure, never a panel to adopt: a scan would find a
		// panel the assistant's own readiness deadline is about to dispose.
		if (timedOut) {
			return undefined;
		}

		return this.findCanvasEditor();
	}

	/**
	 * Whether this part's window carries the locked-compact trait that makes
	 * a dedicated Canvas window chromeless. Only entry and restore create
	 * such windows; a Canvas the user detached by hand lacks the trait.
	 */
	private isDedicatedCanvasWindow(part: IEditorPart): boolean {
		if (part === this.editorGroupsService.mainPart) {
			return false;
		}
		return this.auxiliaryWindowService.getWindow(part.windowId)?.createState().lockCompact === true;
	}

	/**
	 * Moves a Canvas panel into a dedicated window of its own. Returns
	 * nothing if the move did not happen, so the caller does not hide the
	 * IDE behind a window that never got its editor. `superseded` is checked
	 * before the panel is moved: a panel pulled out of an IDE window the
	 * user was just handed back is worse than no window at all.
	 */
	private async promoteToCanvasWindow(canvas: ICanvasEditor, superseded: () => boolean): Promise<{ part: IAuxiliaryEditorPart; group: IEditorGroup } | undefined> {
		let part: IAuxiliaryEditorPart;
		try {
			part = await this.editorGroupsService.createAuxiliaryEditorPart(dedicatedWindowOptions(getActiveWindow(), {
				// Compact mode is what makes the window chromeless, so it must
				// not be something a stray editor or menu action can switch off.
				lockCompact: true
			}));
		} catch (error) {
			this.logService.error('[canvas] Could not create a window for Canvas', error);
			return undefined;
		}

		if (superseded()) {
			// Empty, so closing it takes its window with it.
			part.close();
			return undefined;
		}

		if (!canvas.group.moveEditors(prepareMoveCopyEditors(canvas.group, [canvas.editor]), part.activeGroup)) {
			this.logService.error('[canvas] Could not move the Canvas editor into its own window');
			part.close();
			return undefined;
		}

		return { part, group: part.activeGroup };
	}

	/**
	 * Takes ownership of the window presenting Canvas: keeps it single-editor,
	 * arranges for the IDE to come back if it disappears, and focuses it.
	 */
	private adoptCanvasWindow(part: IEditorPart, group: IEditorGroup): void {
		this.stopPresenting();

		const disposables = new DisposableStore();

		// A locked group keeps Canvas alone in its window: compact mode draws
		// no tabs, so an unlocked group would let a file opened while Canvas
		// has focus silently cover it.
		group.lock(true);

		// The window can also go away without anyone asking us (OS close
		// button, renderer crash); the IDE window has to come back.
		disposables.add(Event.once(part.onWillDispose)(() => {
			this.logService.info(`[canvas] The Canvas window (${part.windowId}) went away while presenting${this.lifecycleService.willShutdown ? ' during shutdown' : '; returning to the IDE'}`);

			// Losing the window supersedes an in-flight entry the same way
			// an exit does.
			this.exitGeneration++;

			this.stopPresenting();
			this.releaseEngagement();

			// The aux part is disposed during an ordinary quit too: clearing
			// the intent there would erase the "quit in Canvas, relaunch into
			// Canvas" record, and revealing the IDE would flash it on its way
			// out.
			if (!this.lifecycleService.willShutdown) {
				this.setCanvasModeIntent(false);
				this.revealIdeWindow().catch(error => this.logService.error('[canvas] Could not bring the Positron window back after the Canvas window went away', error));
			}
		}));

		this.canvasWindow.value = disposables;
		this.canvasGroup = group;
		this.modeActiveContext.set(true);
		this.setCanvasModeIntent(true);
		this.logService.info(`[canvas] Presenting Canvas in window ${part.windowId}`);

		// A restored window held for startup is now the Canvas window: show
		// it. Issued before the IDE hide that follows adoption, on the same
		// channel, so there is a visible window throughout.
		if (this.hiddenAuxWindowIds.delete(part.windowId)) {
			this.nativeHostService.showWindow({ targetWindowId: part.windowId })
				.catch(error => this.logService.error(`[canvas] Could not show the restored Canvas window ${part.windowId}`, error));
		}

		group.focus();
	}

	/**
	 * Forget the window we were presenting Canvas in. Does not touch the
	 * group: this also runs while that window is being disposed.
	 */
	private stopPresenting(): void {
		this.canvasWindow.clear();
		this.canvasGroup = undefined;
		this.modeActiveContext.set(false);
	}

	/**
	 * Records, or forgets, that this workspace should come back into Canvas
	 * mode: set while presenting, cleared by every way of leaving except
	 * shutdown. MACHINE-targeted: it describes this installation's windows.
	 */
	private setCanvasModeIntent(active: boolean): void {
		if (active) {
			this.storageService.store(CANVAS_MODE_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
		}
	}

	async holdRestoredWindow(windowId: number): Promise<void> {
		this.logService.info(`[canvas] Holding restored window ${windowId} while booting into Canvas`);
		// Recorded before the hide lands, like the entry's own hides; a hide
		// that resolves false found the window already away, and a later
		// re-show of a visible window is harmless.
		this.hiddenAuxWindowIds.add(windowId);
		try {
			await this.nativeHostService.hideWindow({ targetWindowId: windowId });
		} catch (error) {
			this.hiddenAuxWindowIds.delete(windowId);
			this.logService.error(`[canvas] Could not hold restored window ${windowId}; leaving it visible`, error);
		}
	}

	private async hideIdeWindow(canvasWindowId: number): Promise<void> {
		this.logService.info('[canvas] Hiding the IDE window behind Canvas');

		// Set unguarded, unlike `revealIdeWindow()`: a forwarded `--canvas`
		// re-entry can reveal the IDE window on its way in, so skipping
		// "already hidden" work would leave it behind Canvas.
		this.ideWindowHidden = true;

		// Hide rather than minimize: minimize animates the IDE into the dock
		// beside the new Canvas window, which reads as two windows rather
		// than Canvas replacing Positron. The IDE is only hidden while a
		// live Canvas window is up; every way of losing that window runs
		// `revealIdeWindow()`.
		const hides = [this.nativeHostService.hideWindow({ targetWindowId: mainWindow.vscodeWindowId })];

		// Canvas is the sole surface: detached editor windows go away too.
		// Recorded before the hide lands, so a rejected hide leaves a window
		// the next reveal harmlessly re-shows rather than one that stays lost.
		// A window already held for startup (`holdRestoredWindow`) stays
		// recorded whatever this hide reports: it is ours to re-show.
		const auxWindowIds: number[] = [];
		const heldBefore: boolean[] = [];
		for (const part of this.editorGroupsService.parts) {
			if (part === this.editorGroupsService.mainPart || part.windowId === canvasWindowId) {
				continue;
			}
			heldBefore.push(this.hiddenAuxWindowIds.has(part.windowId));
			this.hiddenAuxWindowIds.add(part.windowId);
			auxWindowIds.push(part.windowId);
			hides.push(this.nativeHostService.hideWindow({ targetWindowId: part.windowId }));
		}

		// Every hide settles before this returns: a rejection surfacing while
		// another hide is in flight would let the caller's unwind reveal a
		// window that hide then re-hides, leaving it lost.
		const results = await Promise.allSettled(hides);

		// The main process abandons a hide it raced; invisible otherwise.
		if (results[0].status === 'fulfilled' && results[0].value === false) {
			this.logService.warn('[canvas] The IDE window did not hide: it was already away, or the hide was abandoned');
		}

		// A hide that resolved false found its window already put away by the
		// user; exit must not bring it back. Unless Canvas put it away itself.
		for (let i = 0; i < auxWindowIds.length; i++) {
			const result = results[i + 1];
			if (result.status === 'fulfilled' && result.value === false && !heldBefore[i]) {
				this.hiddenAuxWindowIds.delete(auxWindowIds[i]);
			}
		}

		for (const result of results) {
			if (result.status === 'rejected') {
				throw result.reason;
			}
		}
	}

	/**
	 * @param force reveal even when we do not believe the IDE window is away,
	 * for the one caller with a hide of its own in flight.
	 */
	private async revealIdeWindow(force = false): Promise<void> {
		if (!this.ideWindowHidden && this.hiddenAuxWindowIds.size === 0 && !force) {
			return;
		}
		this.logService.info('[canvas] Revealing the IDE window');

		// A hidden window is not brought back by focus alone; show it first.
		// The flag flips only after the show lands, so a rejected show is
		// retried by the next reveal instead of early-returning above.
		await this.nativeHostService.showWindow({ targetWindowId: mainWindow.vscodeWindowId });
		this.ideWindowHidden = false;

		// Exactly the windows entry hid, forgotten as each show lands. Only
		// the main window's show may abort the reveal: an exit stopping here
		// would merge the live Canvas into a window that is still hidden.
		for (const windowId of [...this.hiddenAuxWindowIds]) {
			try {
				await this.nativeHostService.showWindow({ targetWindowId: windowId });
				this.hiddenAuxWindowIds.delete(windowId);
			} catch (error) {
				this.logService.error(`[canvas] Could not re-show window ${windowId}; the next reveal will retry`, error);
			}
		}

		await this.hostService.focus(mainWindow);
	}
}
