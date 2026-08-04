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
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { EditorsOrder } from '../../../common/editor.js';
import { IAuxiliaryEditorPart, IEditorGroup, IEditorGroupsService, IEditorPart, GroupsOrder } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { dedicatedWindowOptions } from '../../positronEditorActions/browser/positronDedicatedWindow.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_WEBVIEW_VIEW_TYPE, CanvasEntryOutcome, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';

/**
 * Posit Assistant's command to open a Canvas panel as an ordinary editor --
 * the only thing core needs from the extension.
 */
const CANVAS_ENSURE_COMMAND = 'posit-assistant.openCanvasInline';

/**
 * Cap on waiting for the assistant to produce a panel. `executeCommand`
 * blocks unboundedly on extension activation; the command itself settles
 * within the assistant's own 14s ensure deadline, so this only adds headroom
 * for activation.
 */
const CANVAS_ENSURE_TIMEOUT = 20_000;

export const IPositronCanvasService = createDecorator<IPositronCanvasService>('positronCanvasService');

export interface IPositronCanvasService {

	readonly _serviceBrand: undefined;

	/**
	 * Present Canvas as the whole product: one conversation in a standalone
	 * window, IDE window out of the way. Absorbs every starting position and
	 * concurrent callers; never leaves the user with no visible window.
	 * Resolves an outcome rather than throwing for known non-entry cases,
	 * because how a non-entry is shown depends on who asked (palette
	 * notification or the assistant across the command seam).
	 */
	enter(): Promise<CanvasEntryOutcome>;

	/**
	 * Whether Canvas is currently the only surface the user can see. Gates
	 * the Canvas UI's "Open Positron" control.
	 */
	readonly isActive: boolean;

	/**
	 * Hand the user back to the full IDE, moving the live conversation into
	 * it rather than throwing it away. Resolves `true` only when it actually
	 * left Canvas mode; the assistant treats anything else as a failed exit.
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
	 * Where the main process hears about the engagement, so it can keep other
	 * windows out, trim the native menus, and route external opens; see
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

	/** In-flight `enter()`; concurrent callers coalesce onto it. */
	private entering: Promise<CanvasEntryOutcome> | undefined;

	/**
	 * Bumped by every `exit()`. Entry is a sequence of awaits; one that
	 * resumes after an exit landed inside it would silently undo the exit, so
	 * `doEnter()` captures the count and rechecks it after each await.
	 */
	private exitGeneration = 0;

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IHostService private readonly hostService: IHostService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
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
	 * process decides atomically, so of two racing windows exactly one
	 * proceeds. Idempotent for the holder, which keeps re-entry legitimate.
	 */
	private async acquireEngagement(): Promise<boolean> {
		try {
			// The exit command travels with the claim, so the main process can
			// ask Canvas to stand down for an external open without knowing
			// about Canvas.
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

	/**
	 * Release after an entry that did not end presenting. Guarded: a failed
	 * re-entry must not drop the claim of the Canvas still being presented.
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

		// Claimed before any other await, so no second window can start an
		// entry between here and the Canvas window appearing.
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

		// A panel already outside the IDE window is one we (or a restore) put
		// there; adopt it as is. Restored windows come back with locked
		// compact mode intact, so there is nothing to repair.
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

		// Only now, with a live Canvas window on screen, is it safe to put
		// the IDE window away.
		try {
			await this.hideIdeWindow();
		} catch (error) {
			// A visible IDE next to Canvas is recoverable; a committed entry
			// over a failed hide is not, so run the normal merge-back transaction.
			this.logService.error('[canvas] Could not put the IDE window away; leaving Canvas mode', error);
			await this.exit();
			return {
				entered: false,
				reason: 'no-window',
				message: localize('positron.canvas.couldNotHideIde', "Canvas could not take over from the Positron window.")
			};
		}

		if (superseded()) {
			// The exit already unwound everything, but its reveal may have
			// raced the minimize in flight here; reveal unconditionally.
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

		// Read before `stopPresenting()`, which is what makes it false.
		const wasActive = this.canvasWindow.value !== undefined;

		// Stop presenting first: it drops the listener that treats the Canvas
		// window going away as something to recover from. The claim goes back
		// even when no Canvas window was up yet -- an exit landing inside an
		// in-flight entry must not leave the early claim behind.
		this.stopPresenting();
		this.releaseEngagement();

		// Show the IDE before moving anything into it: the move focuses its
		// target, and focusing a group in an off-screen window leaves the
		// user with no visible focused window.
		await this.revealIdeWindow();

		if (canvasGroup) {
			// Unlock so the group is an ordinary group for as long as it
			// survives the merge.
			canvasGroup.lock(false);

			// Merge, never `close()`: close treats a webview panel as
			// non-confirming and destroys it, dropping the live conversation.
			if (!this.editorGroupsService.mergeGroup(canvasGroup, this.editorGroupsService.mainPart.activeGroup)) {
				this.logService.error('[canvas] Could not merge the Canvas group into the IDE; moving its editors individually');
				canvasGroup.moveEditors(prepareMoveCopyEditors(canvasGroup, canvasGroup.editors.slice()), this.editorGroupsService.mainPart.activeGroup);
			}

			// The editor area auto-hides when its last editor leaves, so an
			// IDE window that had only Canvas open comes back without one.
			// Only when the merge happened: an exit with nothing to merge
			// must not override an editor area the user hid deliberately.
			this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
			this.editorGroupsService.mainPart.activeGroup.focus();
		}

		return wasActive;
	}

	/**
	 * The most recently active Canvas panel anywhere in the workbench.
	 * The assistant's ensure command owns singleton-ness; this scan only finds
	 * the ready panel that command selected or created.
	 */
	private findCanvasEditor(): ICanvasEditor | undefined {
		const found: ICanvasEditor[] = [];

		for (const group of this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			// `group.editors` is tab order; only `getEditors(MOST_RECENTLY_ACTIVE)`
			// orders within a group.
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
		// `raceTimeout` resolves undefined on timeout and when the command
		// resolves undefined (which it always does); only the callback can
		// tell them apart.
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

		// A timeout is a failure, never a panel to adopt: the panel a scan
		// would find is one the assistant is still working on, and its own
		// readiness deadline is about to dispose it. Adopting it would report
		// success, minimize the IDE, then bounce the user back.
		if (timedOut) {
			return undefined;
		}

		return this.findCanvasEditor();
	}

	/**
	 * Moves a Canvas panel out of the IDE window into a window of its own.
	 * Returns nothing if the move did not happen, so the caller does not hide
	 * the IDE behind a window that never got its editor. `superseded` is
	 * checked before the panel is moved: a panel pulled out of an IDE window
	 * the user was just handed back is worse than no window at all.
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

		// A locked group keeps Canvas alone in its window: the editor service
		// routes anything else to the next unlocked group, back in the IDE.
		// Without it a file opened while Canvas has focus would silently
		// cover Canvas, since compact mode draws no tabs.
		group.lock(true);

		// The window can also go away without anyone asking us (OS close
		// button, renderer crash); the IDE window has to come back.
		disposables.add(Event.once(part.onWillDispose)(() => {
			// Losing the window supersedes an in-flight entry the same way an
			// exit does; without this it would resume and report success for
			// a window that no longer exists.
			this.exitGeneration++;

			this.stopPresenting();
			this.releaseEngagement();

			void this.revealIdeWindow();
		}));

		this.canvasWindow.value = disposables;
		this.canvasGroup = group;
		this.modeActiveContext.set(true);

		group.focus();
	}

	/**
	 * Forget the window we were presenting Canvas in. Does not touch the
	 * group: this also runs while that window is being disposed, and the
	 * group's lock dies with it either way.
	 */
	private stopPresenting(): void {
		this.canvasWindow.clear();
		this.canvasGroup = undefined;
		this.modeActiveContext.set(false);
	}

	private async hideIdeWindow(): Promise<void> {
		// Unguarded, unlike `revealIdeWindow()`: re-entry can focus
		// (un-minimize) the IDE window on its way in, so skipping "already
		// hidden" work would leave it behind Canvas.
		this.ideWindowHidden = true;

		// Minimize rather than hide: a minimized window is still listed by
		// the OS, so the user can always get back to Positron, and an app
		// with no visible windows has its own hazards.
		await this.nativeHostService.minimizeWindow({ targetWindowId: mainWindow.vscodeWindowId });
	}

	/**
	 * @param force reveal even when we do not believe the IDE window is away,
	 * for the one caller with a minimize of its own in flight.
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
