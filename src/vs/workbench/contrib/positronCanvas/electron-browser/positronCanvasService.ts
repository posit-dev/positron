/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
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
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { suppressImplicitWindowFocus } from '../../../browser/positronWindowFocus.js';
import { EditorsOrder } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart, GroupsOrder } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { dedicatedWindowOptions } from '../../positronEditorActions/browser/positronDedicatedWindow.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CanvasPlaceholderInput } from '../browser/canvasPlaceholderEditor.js';
import { mergeCanvasGroupIntoIde } from '../browser/positronCanvasRestore.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE, CanvasEntryOutcome, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/** Posit Assistant's command to open a Canvas panel as an ordinary editor. */
const CANVAS_ENSURE_COMMAND = 'posit-assistant.ensureCanvas';

/**
 * Cap on waiting for the assistant to produce a panel. The command settles
 * within the assistant's own 14s ensure deadline; the headroom is for
 * extension activation, which `executeCommand` blocks on unboundedly and
 * which starts from cold both at startup and after the extension host
 * restart of a folder switch.
 */
const CANVAS_ENSURE_TIMEOUT = 30_000;

/**
 * How long a reload request may take to start unloading this renderer before
 * it is taken to have been refused (an unload veto).
 */
const RELOAD_VETO_GRACE = 2_000;

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

	/** Fires with the new value when Canvas starts or stops presenting. */
	readonly onDidChangeActive: Event<boolean>;

	/**
	 * DOM container of the window presenting Canvas, for overlays drawn over
	 * Canvas such as the folder switch curtain. Undefined when not presenting.
	 */
	readonly canvasContainer: HTMLElement | undefined;

	/**
	 * Hand the user back to the full IDE, moving the live conversation into
	 * it. Resolves `true` only when it actually left Canvas mode. Waits for
	 * an in-flight `rebuild` to drain first, so the window is never handed
	 * back while a transaction can still change it.
	 */
	exit(): Promise<boolean>;

	/**
	 * While presenting: close the Canvas panel but keep its window alive (a
	 * read-only placeholder holds the locked group), clear the stored mode
	 * intent, run `between`, then ask the assistant for a fresh panel, move
	 * it into the Canvas window, drop the placeholder and set the intent
	 * again. Staged: ownership of the placeholder is recorded before the
	 * first mutation, and a rejected rebuild leaves the stage where it
	 * stopped so that calling again resumes it. The token is cancelled by
	 * `exit()`, by the Canvas window going away and by shutdown; `between`
	 * is expected to settle after cancellation, and the rebuild then rejects
	 * with a `CancellationError` without asking for a panel. Rejects with a
	 * presentable message while an entry, exit or another rebuild is in
	 * flight.
	 */
	rebuild(between: (token: CancellationToken) => Promise<void>): Promise<void>;

	/**
	 * Reload this window into the IDE, whatever the stored intent or the
	 * openOnStartup setting says. Resolves `true` when the reload was
	 * accepted (this renderer is going away) and `false` when it was
	 * refused by an unload veto, after withdrawing the one-use intent.
	 */
	reloadIntoIde(): Promise<boolean>;
}

/** A Canvas panel and the group it currently lives in. */
interface ICanvasEditor {
	readonly group: IEditorGroup;
	readonly editor: WebviewInput;
}

/**
 * A Canvas window with its panel taken out for a rebuild. `stage` is the
 * last mutation that completed, so a retry resumes rather than repeats.
 */
interface IDetachedCanvas {
	readonly placeholder: CanvasPlaceholderInput;
	stage: 'allocated' | 'placeholder-open' | 'panel-closed' | 'ready';
	/** The panel this rebuild closed; never adopted again. */
	closed: WebviewInput | undefined;
}

function isCanvasPanel(editor: EditorInput): editor is WebviewInput {
	return editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE;
}

export class PositronCanvasService extends Disposable implements IPositronCanvasService {

	declare readonly _serviceBrand: undefined;

	private readonly modeActiveContext: IContextKey<boolean>;

	private readonly _onDidChangeActive = this._register(new Emitter<boolean>());
	readonly onDidChangeActive = this._onDidChangeActive.event;

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
	private readonly hiddenWindowFocus = this._register(new MutableDisposable<DisposableStore>());

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
	 * In-flight `rebuild()` and the token that cancels it. Exit and window
	 * loss cancel and then wait for it, so the transaction inside it has
	 * settled before the window is handed back or the claim released.
	 */
	private rebuilding: Promise<void> | undefined;
	private rebuildCancellation: CancellationTokenSource | undefined;

	/** The Canvas window's panel taken out by a rebuild in progress or stalled. */
	private detached: IDetachedCanvas | undefined;

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
		// Wait out an in-flight exit or rebuild, but only an exit arriving
		// after this call may retire the entry: capture the generation
		// synchronously, past the in-flight exit's bump. No deadlock: exit
		// never awaits an entry, a rebuild never starts one, and the
		// hide-failure exit inside `doEnterEngaged` starts while this entry
		// is already past this point.
		const generationAtRequest = this.exitGeneration;
		while (this.exiting || this.rebuilding) {
			await (this.exiting ?? this.rebuilding)?.then(() => undefined, () => undefined);
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

	get canvasContainer(): HTMLElement | undefined {
		const group = this.canvasGroup;
		const part = group && this.editorGroupsService.getPart(group);
		return part && this.auxiliaryWindowService.getWindow(part.windowId)?.container;
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

		// A rebuild in flight is told to stop and then waited out: its
		// transaction may hold a main-process call that cannot be cancelled,
		// and the window must not be handed back, nor the claim released,
		// while that call can still change the window's identity.
		await this.drainRebuild();

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

			// A stalled rebuild's placeholder rode along with the merge.
			await this.disposeDetached();
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

	/** Cancel a rebuild in flight and wait for its transaction to settle. */
	private async drainRebuild(): Promise<void> {
		if (!this.rebuilding) {
			return;
		}
		this.logService.info('[canvas] Waiting for the workspace switch in flight to stop');
		this.rebuildCancellation?.cancel();
		await this.rebuilding.then(() => undefined, () => undefined);
	}

	rebuild(between: (token: CancellationToken) => Promise<void>): Promise<void> {
		if (this.entering || this.exiting || this.rebuilding) {
			return Promise.reject(new Error(localize('positron.canvas.rebuildBusy', "Canvas is busy opening or closing; try again in a moment.")));
		}
		const group = this.canvasGroup;
		if (!group) {
			return Promise.reject(new Error(localize('positron.canvas.switchNotPresenting', "Canvas is not open in its own window.")));
		}

		const cancellation = new CancellationTokenSource();
		this.rebuildCancellation = cancellation;
		const rebuilding = this.doRebuild(group, between, cancellation.token).finally(() => {
			if (this.rebuilding === rebuilding) {
				this.rebuilding = undefined;
				this.rebuildCancellation = undefined;
			}
			cancellation.dispose();
		});
		this.rebuilding = rebuilding;
		return rebuilding;
	}

	private async doRebuild(group: IEditorGroup, between: (token: CancellationToken) => Promise<void>, token: CancellationToken): Promise<void> {
		const generation = this.exitGeneration;
		const superseded = () => token.isCancellationRequested || this.exitGeneration !== generation;

		await this.detachPanel(group);
		if (superseded()) {
			throw new CancellationError();
		}

		await between(token);
		if (superseded()) {
			throw new CancellationError();
		}

		await this.restorePanel(group, superseded);
	}

	/**
	 * Takes the Canvas panel out of its window, keeping the window alive.
	 * Resumes from the recorded stage, so a retry never opens a second
	 * placeholder or clears the intent twice.
	 */
	private async detachPanel(group: IEditorGroup): Promise<void> {
		const detached = this.detached ??= { placeholder: new CanvasPlaceholderInput(), stage: 'allocated', closed: undefined };

		if (detached.stage === 'allocated') {
			// An empty group closes its window and takes Canvas mode with
			// it; the placeholder keeps the window alive while Canvas is gone.
			await group.openEditor(detached.placeholder, { pinned: true, preserveFocus: true });
			if (!group.contains(detached.placeholder)) {
				throw new Error(localize('positron.canvas.switchNoPlaceholder', "The Canvas window could not be prepared."));
			}
			detached.stage = 'placeholder-open';
		}

		if (detached.stage === 'placeholder-open') {
			for (const panel of group.editors.filter(isCanvasPanel)) {
				if (!await group.closeEditor(panel, { preserveFocus: true })) {
					throw new Error(localize('positron.canvas.switchPanelOpen', "The Canvas panel could not be closed."));
				}
				detached.closed = panel;
			}
			detached.stage = 'panel-closed';
		}

		if (detached.stage === 'panel-closed') {
			// The folder being left must stop claiming Canvas mode before
			// its storage closes: a relaunch of it should open the IDE.
			this.setCanvasModeIntent(false);
			detached.stage = 'ready';
		}
	}

	/**
	 * Asks the assistant for a fresh panel and puts the window back together
	 * around it. Every step re-checks `superseded` after an await, so an
	 * exit that lands mid-way stops it before it publishes the mode flag.
	 */
	private async restorePanel(group: IEditorGroup, superseded: () => boolean): Promise<void> {
		const detached = this.detached;
		if (!detached) {
			throw new Error(localize('positron.canvas.switchNoPlaceholder', "The Canvas window could not be prepared."));
		}

		// The assistant creates the panel in the active group. Unlocking
		// lets that be this group, so the panel needs no second webview
		// move; the lock is Canvas mode's and goes back either way.
		group.focus();
		const wasLocked = group.isLocked;
		group.lock(false);
		let ensured: 'ready' | 'timeout' | 'failed';
		try {
			ensured = await this.runEnsureCommand();
		} finally {
			group.lock(wasLocked);
		}
		if (superseded()) {
			throw new CancellationError();
		}
		if (ensured === 'timeout') {
			throw new Error(localize('positron.canvas.switchNotReady', "Canvas did not finish starting in the new workspace."));
		}

		// A failed command, or one that produced nothing, are the same to
		// the user; only the log tells them apart.
		const rebuilt = ensured === 'ready' ? this.findCanvasEditor(detached.closed) : undefined;
		if (!rebuilt) {
			throw new Error(localize('positron.canvas.switchNoPanel', "Canvas did not open in the new workspace."));
		}
		if (rebuilt.group !== group && !rebuilt.group.moveEditors(prepareMoveCopyEditors(rebuilt.group, [rebuilt.editor]), group)) {
			throw new Error(localize('positron.canvas.switchNoMove', "Canvas could not return to its window."));
		}
		await group.openEditor(rebuilt.editor, { pinned: true, preserveFocus: true });
		if (superseded()) {
			throw new CancellationError();
		}

		if (group.contains(detached.placeholder) && !await group.closeEditor(detached.placeholder, { preserveFocus: true })) {
			throw new Error(localize('positron.canvas.switchPlaceholderOpen', "The Canvas window could not be cleaned up."));
		}
		// The group disposes an input it closed and holds nowhere else; a
		// placeholder that was never adopted anywhere is ours to drop.
		detached.placeholder.dispose();
		this.detached = undefined;
		if (superseded()) {
			throw new CancellationError();
		}

		// The mode flag follows the folder: the destination now relaunches
		// into Canvas, as the source did before `detachPanel` cleared it.
		this.setCanvasModeIntent(true);
		group.focus();
	}

	/**
	 * Drop a stalled rebuild's placeholder wherever it ended up (its own
	 * window, or the IDE after a merge), or dispose it if it never opened.
	 */
	private async disposeDetached(): Promise<void> {
		const detached = this.detached;
		if (!detached) {
			return;
		}
		this.detached = undefined;
		const holder = this.editorGroupsService.groups.find(group => group.contains(detached.placeholder));
		if (holder) {
			await holder.closeEditor(detached.placeholder, { preserveFocus: true });
		}
		detached.placeholder.dispose();
	}

	async reloadIntoIde(): Promise<boolean> {
		const windowId = mainWindow.vscodeWindowId;
		await this.standaloneModeChannel.requestIdeRecovery(windowId);
		// Belt for the storage that is current right now; the one-use intent
		// above is what decides the boot when the destination's storage
		// still holds its own flag.
		this.setCanvasModeIntent(false);

		// A reload that is accepted unloads this renderer; one that an
		// unload veto refused leaves it running, and the intent must not
		// wait for some later reload.
		const disposables = new DisposableStore();
		try {
			const unloading = new Promise<true>(resolve => disposables.add(this.lifecycleService.onWillShutdown(() => resolve(true))));
			await this.hostService.reload();
			const accepted = await raceTimeout(unloading, RELOAD_VETO_GRACE) === true;
			if (!accepted) {
				this.logService.warn('[canvas] The reload into the IDE was refused; withdrawing the one-use IDE recovery');
				await this.standaloneModeChannel.cancelIdeRecovery(windowId);
			}
			return accepted;
		} finally {
			disposables.dispose();
		}
	}

	/**
	 * The most recently active Canvas panel anywhere in the workbench, other
	 * than `exclude`. The assistant's ensure command owns singleton-ness;
	 * this scan only finds the ready panel that command selected or created.
	 */
	private findCanvasEditor(exclude?: WebviewInput): ICanvasEditor | undefined {
		const found: ICanvasEditor[] = [];

		for (const group of this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			for (const editor of group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
				if (isCanvasPanel(editor) && editor !== exclude && !editor.isDisposed()) {
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

	/**
	 * Runs the assistant's ensure command. `raceTimeout` resolves undefined
	 * on timeout and on completion (the command always resolves undefined),
	 * so only the callback tells them apart. A timeout is never followed by
	 * a scan: a panel found then may be one the assistant's own readiness
	 * deadline is about to dispose.
	 */
	private async runEnsureCommand(): Promise<'ready' | 'timeout' | 'failed'> {
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
			return 'failed';
		}

		return timedOut ? 'timeout' : 'ready';
	}

	private async ensureCanvasEditor(): Promise<ICanvasEditor | undefined> {
		return await this.runEnsureCommand() === 'ready' ? this.findCanvasEditor() : undefined;
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
		// Re-adoption by a re-entry is not Canvas going away.
		this.stopPresenting(false);

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
			// an exit does, and stops a rebuild in flight.
			this.exitGeneration++;
			this.rebuildCancellation?.cancel();
			const rebuilding = this.rebuilding;

			this.stopPresenting();

			// The claim is released only once the transaction inside the
			// rebuild has settled: an external open waiting on the release
			// must not reuse a window whose identity is still changing.
			const release = () => this.releaseEngagement();
			if (rebuilding) {
				rebuilding.then(release, release);
			} else {
				release();
			}

			// The placeholder went with the window; forget it either way.
			this.disposeDetached().catch(error => this.logService.error('[canvas] Could not drop the switch placeholder after the Canvas window went away', error));

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
		this._onDidChangeActive.fire(true);
		this.setCanvasModeIntent(true);
		this.logService.info(`[canvas] Presenting Canvas in window ${part.windowId}`);

		group.focus();
	}

	/**
	 * Forget the window we were presenting Canvas in. Does not touch the
	 * group: this also runs while that window is being disposed.
	 *
	 * @param notify whether to announce the change; re-adoption passes false
	 * because Canvas is not going away, it is being taken over again.
	 */
	private stopPresenting(notify = true): void {
		const wasPresenting = this.canvasWindow.value !== undefined;
		this.canvasWindow.clear();
		this.canvasGroup = undefined;
		this.modeActiveContext.set(false);
		if (wasPresenting && notify) {
			this._onDidChangeActive.fire(false);
		}
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

	private async hideIdeWindow(canvasWindowId: number): Promise<void> {
		this.logService.info('[canvas] Hiding the IDE window behind Canvas');

		// Set unguarded, unlike `revealIdeWindow()`: a forwarded `--canvas`
		// re-entry can reveal the IDE window on its way in, so skipping
		// "already hidden" work would leave it behind Canvas.
		this.ideWindowHidden = true;
		const focusSuppression = new DisposableStore();
		focusSuppression.add(suppressImplicitWindowFocus(mainWindow));
		this.hiddenWindowFocus.value = focusSuppression;

		// Hide rather than minimize: minimize animates the IDE into the dock
		// beside the new Canvas window, which reads as two windows rather
		// than Canvas replacing Positron. The IDE is only hidden while a
		// live Canvas window is up; every way of losing that window runs
		// `revealIdeWindow()`.
		const hides = [this.nativeHostService.hideWindow({ targetWindowId: mainWindow.vscodeWindowId })];

		// Canvas is the sole surface: detached editor windows go away too.
		// Recorded before the hide lands, so a rejected hide leaves a window
		// the next reveal harmlessly re-shows rather than one that stays lost.
		const auxWindowIds: number[] = [];
		for (const part of this.editorGroupsService.parts) {
			if (part === this.editorGroupsService.mainPart || part.windowId === canvasWindowId) {
				continue;
			}
			this.hiddenAuxWindowIds.add(part.windowId);
			const hiddenWindow = this.auxiliaryWindowService.getWindow(part.windowId)?.window;
			if (hiddenWindow) {
				focusSuppression.add(suppressImplicitWindowFocus(hiddenWindow));
			}
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
		// user; exit must not bring it back.
		for (let i = 0; i < auxWindowIds.length; i++) {
			const result = results[i + 1];
			if (result.status === 'fulfilled' && result.value === false) {
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
		this.hiddenWindowFocus.clear();

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
