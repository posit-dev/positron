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
import { POSITRON_CANVAS_MODE_CHANNEL_NAME } from '../../../../platform/positronCanvasMode/common/positronCanvasMode.js';
import { PositronCanvasModeChannelClient } from '../../../../platform/positronCanvasMode/common/positronCanvasModeIpc.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IEditorGroup, IEditorGroupsService, IEditorPart, GroupsOrder } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { dedicatedWindowOptions } from '../../positronEditorActions/browser/positronDedicatedWindow.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE, CanvasEntryOutcome, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/**
 * Posit Assistant's command to open a Canvas panel as an ordinary editor. It is
 * the only thing core needs from the extension: everything about presenting
 * that editor as a standalone product surface is decided here.
 */
const CANVAS_CREATE_COMMAND = 'posit-assistant.openCanvasInline';

/**
 * Cap on how long we wait for the assistant to produce a Canvas panel.
 * `executeCommand` blocks on extension activation, and that leg is otherwise
 * unbounded: a wedged or failing `activate()` would leave the caller (and, on
 * startup, the whole Canvas boot) hanging forever with nothing on screen.
 * The command itself resolves or rejects within the assistant's own 14s
 * ensure deadline, so this only needs headroom for activation on top of that.
 */
const CANVAS_CREATE_TIMEOUT = 20_000;

export const IPositronCanvasService = createDecorator<IPositronCanvasService>('positronCanvasService');

export interface IPositronCanvasService {

	readonly _serviceBrand: undefined;

	/**
	 * Present Canvas as the whole product: one conversation in a standalone
	 * window with no workbench chrome, with the IDE window out of the way.
	 *
	 * Absorbs every starting position -- no Canvas panel yet, one in the IDE
	 * window, one already restored into its own window, several open at once --
	 * and concurrent callers, so entry points do not each need their own
	 * bookkeeping. Never leaves the user with no visible window.
	 *
	 * Resolves an outcome rather than throwing for the known non-entry cases,
	 * because how a non-entry should be shown depends on who asked: the startup
	 * curtain turns it into a card, the palette action into a notification, and
	 * Posit Assistant switches on it across the command seam. Only an
	 * unanticipated bug still surfaces as a rejection.
	 */
	enter(): Promise<CanvasEntryOutcome>;

	/**
	 * Whether Canvas is currently the only surface the user can see. Posit
	 * Assistant asks, so that the Canvas UI only offers its way back to the IDE
	 * when there is an IDE to go back to.
	 */
	readonly isActive: boolean;

	/**
	 * Hand the user back to the full IDE, with the live Canvas conversation
	 * moved into it rather than thrown away.
	 *
	 * Resolves `true` when it actually left Canvas mode, that is when a Canvas
	 * window was being presented. Posit Assistant treats anything else as a
	 * failed exit, so the value is a contract, not a convenience.
	 */
	exit(): Promise<boolean>;
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
	 * Where the main process hears about Canvas mode. It needs to know so it
	 * can keep new windows from entering Canvas too, trim the native
	 * application menu, and route externally requested opens; see
	 * `IPositronCanvasModeMainService`.
	 */
	private readonly canvasModeChannel: PositronCanvasModeChannelClient;

	/** Whether this window currently holds the application-wide Canvas claim. */
	private engagementHeld = false;

	/**
	 * The window currently presenting Canvas, plus everything that has to be
	 * undone when it stops doing so. Disposing the store is the whole teardown.
	 */
	private readonly canvasWindow = this._register(new MutableDisposable<DisposableStore>());
	private canvasGroup: IEditorGroup | undefined;

	/** Set while the IDE window has been put away on Canvas's behalf. */
	private ideWindowHidden = false;

	/**
	 * In-flight `enter()`. Startup and a user command can arrive together, and
	 * two callers that both find no Canvas panel would each create one.
	 */
	private entering: Promise<CanvasEntryOutcome> | undefined;

	/**
	 * Bumped by every `exit()`. Entry is a sequence of awaits -- asking the
	 * assistant for a panel, creating a window, minimizing the IDE -- and an
	 * exit that lands inside one of them has already cleared the durable intent
	 * and put the IDE back on screen. An entry that resumed without noticing
	 * would silently undo all of it, so `doEnter()` captures the count and
	 * rechecks it after each await.
	 */
	private exitGeneration = 0;

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
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
		this.canvasModeChannel = new PositronCanvasModeChannelClient(mainProcessService.getChannel(POSITRON_CANVAS_MODE_CHANNEL_NAME));
	}

	/**
	 * Claim the application-wide Canvas engagement before doing any entry
	 * work. The main process decides atomically, so of two windows racing to
	 * enter exactly one proceeds; the loser gets `false` and must not touch
	 * a single window. Idempotent for the holder, which is what keeps
	 * re-entry (a forwarded `--canvas` launch into the engaged window)
	 * legitimate.
	 */
	private async acquireEngagement(): Promise<boolean> {
		try {
			const granted = await this.canvasModeChannel.acquire(mainWindow.vscodeWindowId);
			this.engagementHeld = this.engagementHeld || granted;
			return granted;
		} catch (error) {
			// Losing the channel means losing the cross-window guarantee, not
			// the ability to present Canvas in this window; failing the entry
			// over it would trade a cosmetic risk for a broken product.
			this.logService.error('[canvas] Could not claim Canvas mode with the main process; continuing', error);
			return true;
		}
	}

	/**
	 * Give the claim back. Fire-and-forget: release exists so other windows
	 * and the main process move on, and failing to say so must not fail the
	 * exit it rode along with.
	 */
	private releaseEngagement(): void {
		if (!this.engagementHeld) {
			return;
		}
		this.engagementHeld = false;
		this.canvasModeChannel.release(mainWindow.vscodeWindowId)
			.catch(error => this.logService.error('[canvas] Could not release Canvas mode with the main process', error));
	}

	/**
	 * Release after an entry that did not end presenting. Guarded, because a
	 * failed or superseded re-entry must not drop the claim of the Canvas
	 * this window is still presenting from before.
	 */
	private releaseEngagementUnlessPresenting(): void {
		if (this.canvasWindow.value === undefined) {
			this.releaseEngagement();
		}
	}

	enter(): Promise<CanvasEntryOutcome> {
		this.entering ??= this.doEnter().finally(() => this.entering = undefined);
		return this.entering;
	}

	private async doEnter(): Promise<CanvasEntryOutcome> {
		// Read live rather than at construction: `ai.enabled` toggles without a
		// window reload, and it has to hold even for a workspace configured to
		// boot into Canvas -- otherwise Canvas mode would activate the very
		// assistant the switch exists to keep off.
		if (this.configurationService.getValue<boolean>(AI_ENABLED_KEY) === false) {
			this.logService.info('[canvas] Not entering Canvas mode: ai.enabled is false');
			return {
				entered: false,
				reason: 'ai-disabled',
				message: localize('positron.canvas.aiDisabled', "Canvas is unavailable because AI features are disabled.")
			};
		}

		// Captured before the claim's await: an exit arriving while the claim
		// is still in flight must supersede this entry like any other.
		const generation = this.exitGeneration;

		// Claimed before any other await, so no second window can start an
		// entry of its own between here and the Canvas window appearing.
		if (!await this.acquireEngagement()) {
			return {
				entered: false,
				reason: 'engaged-elsewhere',
				message: localize('positron.canvas.engagedElsewhere', "Canvas is already open in another Positron window.")
			};
		}

		try {
			return await this.doEnterEngaged(generation);
		} finally {
			// An entry that did not end presenting gives the claim back;
			// success keeps it until exit or the window goes away.
			this.releaseEngagementUnlessPresenting();
		}
	}

	private async doEnterEngaged(generation: number): Promise<CanvasEntryOutcome> {
		const superseded = () => this.exitGeneration !== generation;
		const supersededOutcome: CanvasEntryOutcome = {
			entered: false,
			reason: 'superseded',
			message: localize('positron.canvas.superseded', "Canvas stopped opening because Positron was asked for the IDE.")
		};

		const canvas = this.findCanvasEditor() ?? await this.createCanvasEditor();
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

		// A Canvas panel that is already outside the IDE window is one we -- or a
		// restore of a previous session -- put there; adopt it as is rather than
		// moving it through another window. Restored windows come back with their
		// native title bar and locked compact mode intact, so there is nothing to
		// repair.
		const part = this.editorGroupsService.getPart(canvas.group);
		const canvasWindow = part === this.editorGroupsService.mainPart
			? await this.promoteToCanvasWindow(canvas, superseded)
			: { part, group: canvas.group };

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

		// Only now, with a live Canvas window on screen, is it safe to put the
		// IDE window away.
		try {
			await this.hideIdeWindow();
		} catch (error) {
			// A visible IDE next to Canvas is recoverable; a committed entry
			// over a failed hide is not, so unwind to the IDE.
			this.logService.error('[canvas] Could not put the IDE window away; leaving Canvas mode', error);
			this.stopPresenting();
			this.releaseEngagement();
			this.setCanvasModeIntent(false);
			await this.revealIdeWindow(true);
			return {
				entered: false,
				reason: 'no-window',
				message: localize('positron.canvas.couldNotHideIde', "Canvas could not take over from the Positron window.")
			};
		}

		if (superseded()) {
			// `exit()` -- or the Canvas window dying under us -- has already
			// unwound everything we set up, but its reveal may have raced
			// ahead of the minimize that was in flight here, so put the IDE
			// back on screen unconditionally.
			this.logService.info('[canvas] Abandoning entry: Canvas went away while the IDE window was being put away');
			await this.revealIdeWindow(true);
			return supersededOutcome;
		}

		return { entered: true };
	}

	get isActive(): boolean {
		return this.modeActiveContext.get() === true;
	}

	async exit(): Promise<boolean> {
		// Retires any entry still in flight, before anything it could race with.
		this.exitGeneration++;

		const canvasGroup = this.canvasGroup;

		// Whether there was anything to leave. Read before `stopPresenting()`,
		// which is what makes it false.
		const wasActive = this.canvasWindow.value !== undefined;

		// Unconditional, and not only when a Canvas window was up: exit means "I
		// want the IDE" in every sense, including what this workspace launches
		// into next time.
		this.setCanvasModeIntent(false);

		// Stop presenting first: it drops the listener that treats the Canvas
		// window going away as something to recover from, which would otherwise
		// fire while we are deliberately emptying the window. The claim goes
		// back too, even when no Canvas window was up yet -- an exit landing
		// inside an in-flight entry is exactly when the early claim must not
		// be left behind.
		this.stopPresenting();
		this.releaseEngagement();

		// Show the IDE window before moving anything into it. The move focuses
		// its target, and focusing a group inside a window that is not on screen
		// leaves the user with no visible focused window at all.
		await this.revealIdeWindow();

		if (canvasGroup) {
			// Unlock before merging so the group is an ordinary group again for as
			// long as it survives the merge.
			canvasGroup.lock(false);

			// Merge, never `IAuxiliaryEditorPart.close()`: close treats a webview
			// panel as non-confirming and destroys it instead of moving it, which
			// would drop the live conversation on the way back to the IDE.
			if (!this.editorGroupsService.mergeGroup(canvasGroup, this.editorGroupsService.mainPart.activeGroup)) {
				// The conversation beats tidiness: move the editors one by one
				// rather than leave the merge's failure silent, and if even
				// that fails the standalone window stays -- alive -- next to
				// the restored IDE.
				this.logService.error('[canvas] Could not merge the Canvas group into the IDE; moving its editors individually');
				canvasGroup.moveEditors(prepareMoveCopyEditors(canvasGroup, canvasGroup.editors.slice()), this.editorGroupsService.mainPart.activeGroup);
			}

			// The editor area auto-hides when its last editor leaves, so an IDE
			// window that had nothing but Canvas open comes back with no editor
			// area. Only when the merge happened: an exit with no Canvas window
			// (the curtain's "Open Positron" after a failed entry) has nothing to
			// undo, and unconditionally unhiding would override an editor area
			// the user hid deliberately.
			this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
			this.editorGroupsService.mainPart.activeGroup.focus();
		}

		return wasActive;
	}

	/**
	 * The most recently active Canvas panel anywhere in the workbench.
	 *
	 * Scanning before creating is what keeps entry idempotent: the assistant's
	 * open command always creates a new panel, so a boot trigger that did not
	 * look first would double the Canvas on every restart.
	 */
	private findCanvasEditor(): ICanvasEditor | undefined {
		const found: ICanvasEditor[] = [];

		for (const group of this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			// `group.editors` is tab order, not use order: with two Canvas panels
			// in one group it would present the leftmost tab. Only
			// `getEditors(MOST_RECENTLY_ACTIVE)` orders within a group, the way
			// `getGroups(MOST_RECENTLY_ACTIVE)` does across them.
			for (const editor of group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
				if (editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE) {
					found.push({ group, editor });
				}
			}
		}

		if (found.length > 1) {
			// Deliberately non-destructive: closing the extras would dispose live
			// assistant sessions the user may have opened on purpose. Canvas mode
			// shows the most recent one; the rest stay in the IDE window.
			this.logService.warn(`[canvas] ${found.length} Canvas panels are open; presenting the most recently active one`);
		}

		return found.at(0);
	}

	private async createCanvasEditor(): Promise<ICanvasEditor | undefined> {
		// `raceTimeout` resolves undefined both when it times out and when the
		// command itself resolves undefined, which the command always does; only
		// the callback can tell the two apart.
		let timedOut = false;

		try {
			// Contributed commands carry an implicit activation event and
			// `executeCommand` waits for activation before dispatching, so one
			// call is enough -- but activation rejects if the extension's
			// `activate()` does, and never settles if it hangs.
			await raceTimeout(
				this.commandService.executeCommand(CANVAS_CREATE_COMMAND),
				CANVAS_CREATE_TIMEOUT,
				() => {
					timedOut = true;
					this.logService.error(`[canvas] ${CANVAS_CREATE_COMMAND} did not complete within ${CANVAS_CREATE_TIMEOUT}ms`);
				}
			);
		} catch (error) {
			this.logService.error(`[canvas] ${CANVAS_CREATE_COMMAND} failed`, error);
			return undefined;
		}

		// A timeout is a failure, never a panel to adopt. The assistant creates
		// the webview panel long before the Canvas inside it is ready, so the
		// panel a scan would find here is one the assistant is still working on
		// -- and if our clock ran out first, its own readiness deadline is about
		// to retire the owner and dispose that panel. Adopting it would report a
		// successful entry, minimize the IDE, and then bounce the user back.
		if (timedOut) {
			return undefined;
		}

		return this.findCanvasEditor();
	}

	/**
	 * Moves a Canvas panel out of the IDE window into a window of its own.
	 * Returns nothing if the move did not happen, so the caller does not hide the
	 * IDE behind a Canvas window that never got its editor.
	 *
	 * Creating the window takes long enough for the user to leave Canvas while
	 * it is happening, so `superseded` is checked before the panel is moved into
	 * it: a Canvas panel pulled out of an IDE window the user has just been
	 * handed back is the one outcome worse than no window at all.
	 */
	private async promoteToCanvasWindow(canvas: ICanvasEditor, superseded: () => boolean): Promise<{ part: IEditorPart; group: IEditorGroup } | undefined> {
		const part = await this.editorGroupsService.createAuxiliaryEditorPart(dedicatedWindowOptions(getActiveWindow(), {
			// Canvas is the product, not an editor someone popped out: compact
			// mode is what makes the window chromeless, so it must not be
			// something a stray editor or a menu action can switch off.
			lockCompact: true
		}));

		if (superseded()) {
			// Empty, so closing it takes its window with it and leaves the panel
			// where the user can see it.
			part.close();
			return undefined;
		}

		if (!canvas.group.moveEditors(prepareMoveCopyEditors(canvas.group, [canvas.editor]), part.activeGroup)) {
			this.logService.error('[canvas] Could not move the Canvas editor into its own window');
			// An auxiliary part with no editors closes itself and takes its window
			// with it, so there is nothing left on screen to clean up.
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

		// A locked group is what keeps Canvas alone in its window: the editor
		// service routes anything else to the next unlocked group, which is
		// always back in the IDE window. Without it a file opened while Canvas
		// has focus would silently cover Canvas, since compact mode draws no tabs.
		group.lock(true);

		// The window can also go away without anyone asking us: the OS close
		// button, a renderer crash, the last editor closing. The IDE window has
		// to come back, or the application is left with nothing on screen.
		disposables.add(Event.once(part.onWillDispose)(() => {
			// Losing the window supersedes an entry still in flight the same
			// way an exit does: without this, an entry awaiting the IDE
			// minimize would resume, find its generation intact, and report
			// success for a Canvas window that no longer exists.
			this.exitGeneration++;

			this.stopPresenting();
			this.releaseEngagement();

			// Only a user who is staying in this session has decided against
			// Canvas. The aux part is disposed during an ordinary quit too, and
			// clearing there would erase the very intent that "quit in Canvas,
			// relaunch into Canvas" is made of.
			if (!this.lifecycleService.willShutdown) {
				this.setCanvasModeIntent(false);
			}

			void this.revealIdeWindow();
		}));

		this.canvasWindow.value = disposables;
		this.canvasGroup = group;
		this.modeActiveContext.set(true);
		this.setCanvasModeIntent(true);

		group.focus();
	}

	/**
	 * Forget the window we were presenting Canvas in. Deliberately does not touch
	 * the group: this also runs while that window is being disposed, and the
	 * group's lock dies with it either way.
	 */
	private stopPresenting(): void {
		this.canvasWindow.clear();
		this.canvasGroup = undefined;
		this.modeActiveContext.set(false);
	}

	/**
	 * Records, or forgets, that this workspace should come back into Canvas mode.
	 *
	 * The invariant is "relaunch into whatever you quit in", so the flag tracks
	 * what is on screen rather than anything the user configured: it is set while
	 * Canvas is being presented and cleared by every way of leaving Canvas that is
	 * not the application shutting down. MACHINE-targeted because it describes
	 * this installation's window state, not something to sync between machines.
	 */
	private setCanvasModeIntent(active: boolean): void {
		if (active) {
			this.storageService.store(CANVAS_MODE_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
		}
	}

	private async hideIdeWindow(): Promise<void> {
		// Deliberately unguarded, unlike `revealIdeWindow()`: entering Canvas
		// again while already in Canvas mode is exactly what a forwarded
		// `--canvas` launch does, and that launch focuses -- un-minimizes -- the
		// IDE window on its way in. Skipping the work because we think the window
		// is already away would leave it sitting behind Canvas.
		this.ideWindowHidden = true;

		// Minimize rather than a true hide: a minimized window is still listed
		// by the OS, so a user who ends up with a Canvas window that never
		// appeared can always get back to Positron themselves, and an
		// application with no visible windows has its own hazards (on macOS,
		// activating from the Dock then opens an empty new window).
		await this.nativeHostService.minimizeWindow({ targetWindowId: mainWindow.vscodeWindowId });
	}

	/**
	 * @param force reveal even when we do not believe the IDE window is away,
	 * for the one caller that has a minimize of its own in flight and so cannot
	 * trust the flag.
	 */
	private async revealIdeWindow(force = false): Promise<void> {
		if (!this.ideWindowHidden && !force) {
			return;
		}
		this.ideWindowHidden = false;

		// Focusing is what un-minimizes; there is no separate restore call.
		await this.hostService.focus(mainWindow);
	}
}
