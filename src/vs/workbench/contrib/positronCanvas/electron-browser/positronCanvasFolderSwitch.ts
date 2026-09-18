/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderWorkspaceService } from '../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { EditorPart } from '../../../browser/parts/editor/editorPart.js';
import { holdStoredEditorLayout } from '../../../browser/positronEditorPartsLayout.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { WorkspaceService } from '../../../services/configuration/browser/configurationService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronBackupHandoffService } from '../../../services/workingCopy/electron-browser/positronBackupHandoff.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { CanvasPlaceholderInput } from '../browser/canvasPlaceholderEditor.js';
import { CanvasSwitchCurtain } from '../browser/canvasSwitchCurtain.js';
import { isAuxiliaryEditorPart } from '../browser/positronCanvasRestore.js';
import { IPositronCanvasService } from './positronCanvasService.js';

/**
 * Experimental command seam for Posit Assistant's Canvas workspace picker;
 * see ../README.md. `positron.experimental.*` rather than `positron.canvas.*`
 * because the shape may still change with the picker.
 */
export const SWITCH_CANVAS_FOLDER_COMMAND_ID = 'positron.experimental.switchCanvasFolder';
export const GET_CANVAS_FOLDERS_COMMAND_ID = 'positron.experimental.getCanvasFolders';

/** The workspace half of a switch, in the order it runs and resumes. */
type SwitchStep = 'detach' | 'commit' | 'restore';

/**
 * Switches the folder a Canvas window presents without leaving Canvas mode:
 * the same native window and renderer take on a new workspace identity, and
 * the assistant rebuilds Canvas inside it.
 *
 * Two halves. Everything that can refuse the switch runs first and changes
 * nothing, rejecting with a user-presentable message for the caller (the
 * assistant's picker) to show. Then a transaction runs behind a curtain in
 * the Canvas window: the Canvas service takes its panel out and later asks
 * the assistant for a new one (`IPositronCanvasService.rebuild`), and in
 * between this class runs the workspace half in three resumable steps:
 * detach (runtimes and extension hosts down), commit (folder identity in the
 * main process, workspace, storage, editors, backups, recents) and restore
 * (extension hosts back up). A step failing stops the transaction where it
 * is; the curtain's Retry Canvas resumes from that step and Open Positron
 * hands the user the IDE in a consistent state. The returned promise settles
 * only when the curtain is down, so the command's caller and the in-flight
 * guard see the transaction's real lifetime.
 */
export class CanvasFolderSwitcher {

	private readonly folderService: ICanvasFolderWorkspaceService;
	private readonly workspaceService: WorkspaceService;

	constructor(
		@IPositronCanvasService private readonly canvasService: IPositronCanvasService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@IPositronBackupHandoffService private readonly backupHandoff: IPositronBackupHandoffService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IWorkspaceTrustManagementService private readonly trustService: IWorkspaceTrustManagementService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
		@INativeHostService nativeHostService: INativeHostService,
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		// `initialize` lives on the workbench implementation, not the
		// interface; the workbench itself casts the same way at startup.
		this.workspaceService = contextService as WorkspaceService;
		this.folderService = ProxyChannel.toService<ICanvasFolderWorkspaceService>(mainProcessService.getChannel('workspaces'), { context: nativeHostService.windowId });
	}

	/**
	 * @param folderPath absolute local path. Resolves without doing anything
	 * when it names the current folder; rejects with a presentable message
	 * when the switch is refused or, after the Canvas window was taken over,
	 * when the user leaves the failed transaction through Open Positron.
	 */
	async switchFolder(folderPath: string): Promise<void> {
		// Read live: `ai.enabled` toggles without a reload, and restoring
		// Canvas asks the assistant for a panel.
		if (this.configurationService.getValue<boolean>(AI_ENABLED_KEY) === false) {
			throw new Error(localize('positron.canvas.switchAiDisabled', "Canvas is unavailable because AI features are disabled."));
		}
		const container = this.canvasService.isActive ? this.canvasService.canvasContainer : undefined;
		if (!container) {
			throw new Error(localize('positron.canvas.switchNotPresenting', "Canvas is not open in its own window."));
		}
		const source = this.currentFolder();

		if (!isAbsolute(folderPath)) {
			throw new Error(localize('positron.canvas.switchAbsolute', "Canvas needs an absolute folder path to switch to."));
		}

		// Main-process validation (exists, is a folder, not open in another
		// window) decides identity the way an ordinary open does, and
		// separately reports the physical folder behind any symlink.
		const { workspace, physicalUri } = await this.folderService.resolveCanvasFolder(URI.file(folderPath));
		if (isEqual(workspace.uri, source)) {
			return;
		}

		// Trust is decided per folder and the prompt renders in the hidden
		// IDE window; an untrusted destination is refused rather than asked.
		// Checked on the logical path (what the workspace becomes) and on the
		// physical one (what a symlink would otherwise let it dodge).
		for (const uri of isEqual(workspace.uri, physicalUri) ? [workspace.uri] : [workspace.uri, physicalUri]) {
			if (!(await this.trustService.getUriTrustInfo(uri)).trusted) {
				throw new Error(localize('positron.canvas.switchUntrusted', "The folder {0} is not trusted. Open it in Positron first to trust it.", folderPath));
			}
		}

		// Dirty editors would need a save prompt inside the hidden IDE, and
		// their backups belong to the folder being left.
		if (this.workingCopyService.hasDirty) {
			throw new Error(localize('positron.canvas.switchDirty', "Save or discard your unsaved changes before switching workspaces."));
		}

		// Shutting down a busy session asks whether to interrupt it, in the
		// hidden IDE window; refuse instead of waiting behind the curtain.
		for (const session of this.runtimeSessionService.activeSessions) {
			this.requireIdle(session);
		}

		await this.transition(container, workspace);
	}

	private currentFolder(): URI {
		if (this.environmentService.remoteAuthority || this.workspaceService.getWorkbenchState() !== WorkbenchState.FOLDER) {
			throw new Error(localize('positron.canvas.switchWorkspaceShape', "Canvas can only switch folders from a local, single-folder workspace."));
		}
		return this.workspaceService.getWorkspace().folders[0].uri;
	}

	private requireIdle(session: ILanguageRuntimeSession): void {
		if (session.getRuntimeState() === RuntimeState.Busy) {
			throw new Error(localize('positron.canvas.switchBusySession', "The {0} session is busy. Wait for it to finish or interrupt it before switching workspaces.", session.dynState.sessionName));
		}
	}

	private transition(container: HTMLElement, target: ISingleFolderWorkspaceIdentifier): Promise<void> {
		const curtain = new CanvasSwitchCurtain(container);
		const done = new DeferredPromise<void>();
		const disposables = new DisposableStore();

		/** Editors in the IDE and detached windows before the switch, by group. */
		let sourceEditors: Map<IEditorGroup, EditorInput[]> | undefined;
		let extensionHostsStopped = false;
		/**
		 * `partial` means the main process may hold the new identity while
		 * this renderer does not yet match it: the only state a reload, not
		 * an exit, recovers from.
		 */
		let commit: 'pending' | 'partial' | 'done' = 'pending';
		let rebuildInFlight = false;
		let recovering = false;
		let lastError: unknown;
		const steps: SwitchStep[] = ['detach', 'commit', 'restore'];
		let next = 0;

		const cancelledError = () => new Error(localize('positron.canvas.switchCancelled', "Canvas was closed while switching workspaces."));

		/** Settles the transaction once; every later call is a no-op. */
		const settle = (error?: unknown) => {
			if (done.isSettled) {
				return;
			}
			disposables.dispose();
			curtain.dispose();
			if (error === undefined) {
				done.complete();
			} else {
				done.error(error);
			}
		};

		const restartExtensionHosts = async () => {
			if (extensionHostsStopped && !this.lifecycleService.willShutdown) {
				await this.extensionService.startExtensionHosts();
				extensionHostsStopped = false;
			}
		};

		const detach = async () => {
			sourceEditors ??= this.captureSourceEditors();

			// Sessions start in the workspace folder, so the destination
			// gets fresh ones. Each shutdown can be declined; a busy one
			// would prompt in the hidden IDE, so it is refused first.
			for (const session of [...this.runtimeSessionService.activeSessions]) {
				this.requireIdle(session);
				let deleted: boolean;
				try {
					deleted = await this.runtimeSessionService.deleteSession(session.sessionId);
				} catch (cause) {
					this.logService.error(`[canvas] Could not shut down the ${session.dynState.sessionName} session for the workspace switch`, cause);
					throw new Error(localize('positron.canvas.switchSessionFailed', "The {0} session could not be shut down.", session.dynState.sessionName), { cause });
				}
				if (!deleted) {
					throw new Error(localize('positron.canvas.switchSession', "Shutting down the {0} session was cancelled.", session.dynState.sessionName));
				}
			}

			// Extensions activate against the workspace; the assistant in
			// particular binds Canvas to it. Vetoes surface as `false`.
			if (!extensionHostsStopped) {
				extensionHostsStopped = await this.extensionService.stopExtensionHosts(localize('positron.canvas.switchStopReason', "Switching the Canvas workspace"));
				if (!extensionHostsStopped) {
					throw new Error(localize('positron.canvas.switchExtensionsVetoed', "An extension declined to stop for the workspace switch."));
				}
			}
		};

		const commitFolder = async () => {
			// Atomic in the main process: it either holds the new identity
			// from here on or refused and still holds the old one. Mirrors
			// NativeWorkspaceEditingService.enterWorkspace for a folder.
			const result = await this.folderService.enterCanvasFolder(target.uri);
			commit = 'partial';
			await this.workspaceService.initialize(result.workspace);

			// The storage switch saves the source's live layout, then
			// swaps storage; both editor-part memento listeners would treat
			// the swap as "adopt the stored layout" (closing the Canvas
			// window among other things), so they are held and the
			// destination's main layout is applied deliberately below.
			const hold = holdStoredEditorLayout();
			try {
				await this.storageService.switch(result.workspace, false);
			} finally {
				hold.dispose();
			}

			// The source's editors close while backups still address the
			// source and the tracker is suspended, then the backup home
			// moves; nothing that happened in the source can touch the
			// destination's backups.
			const backupHome = result.backupPath ? URI.file(result.backupPath).with({ scheme: this.environmentService.userRoamingDataHome.scheme }) : undefined;
			await this.backupHandoff.rehome(backupHome, () => this.closeSourceEditors(sourceEditors ?? new Map()));

			const mainPart = this.editorGroupsService.mainPart;
			if (mainPart instanceof EditorPart) {
				await mainPart.applyStoredState();
			}

			await this.workspacesService.addRecentlyOpened([{ folderUri: result.workspace.uri }]);
			commit = 'done';
		};

		const restore = async () => {
			if (extensionHostsStopped) {
				await this.extensionService.startExtensionHosts();
				extensionHostsStopped = false;
			}
		};

		const run: Record<SwitchStep, () => Promise<void>> = { detach, commit: commitFolder, restore };

		/**
		 * The workspace half, resumable from the failed step. On
		 * cancellation it stops before the commit if the commit has not
		 * started; a commit under way runs to the end so the renderer
		 * matches what the main process now holds, or reloads if it cannot.
		 */
		const between = async (token: CancellationToken) => {
			let failure: unknown;
			try {
				while (next < steps.length) {
					if (token.isCancellationRequested && commit === 'pending') {
						break;
					}
					await run[steps[next]]();
					next++;
				}
			} catch (error) {
				failure = error;
			}
			if (!token.isCancellationRequested) {
				if (failure !== undefined) {
					throw failure;
				}
				return;
			}

			// Canvas is leaving: the exit or window loss that cancelled us is
			// waiting for this to settle before it hands back the IDE.
			if (this.lifecycleService.willShutdown) {
				// Nothing recovers during a quit; the renderer is going away.
				throw new CancellationError();
			}
			if (failure !== undefined && commit === 'partial') {
				// The main process holds the new folder and this renderer could
				// not follow; the main process wins on reload. A refused reload
				// leaves the failure to the card.
				this.logService.error('[canvas] The workspace switch was cancelled with the main process holding the new folder; reloading', failure);
				if (await this.canvasService.reloadIntoIde()) {
					throw new CancellationError();
				}
				throw failure;
			}
			if (failure !== undefined) {
				this.logService.error('[canvas] The workspace switch was cancelled after a step failed; handing back the IDE', failure);
			}
			await restartExtensionHosts();
			throw new CancellationError();
		};

		const showFailure = (error: unknown) => {
			lastError = error;
			curtain.showFailure(toErrorMessage(error), {
				retry: () => void runRecovery(advance),
				openPositron: () => void runRecovery(openPositron)
			});
		};

		const advance = async () => {
			curtain.showLoading();
			rebuildInFlight = true;
			try {
				await this.canvasService.rebuild(between);
				settle();
			} catch (error) {
				if (isCancellationError(error)) {
					this.logService.info(`[canvas] Switching the Canvas workspace to ${target.uri.fsPath} stopped: Canvas was closed`);
					settle(cancelledError());
					return;
				}
				this.logService.error(`[canvas] Switching the Canvas workspace to ${target.uri.fsPath} stopped at step ${Math.min(next + 1, steps.length)} of ${steps.length}`, error);
				showFailure(error);
			} finally {
				rebuildInFlight = false;
			}
		};

		const openPositron = async () => {
			curtain.showLoading();
			if (commit === 'partial') {
				// Renderer and main process may disagree about the folder;
				// the main process wins on reload, so reload rather than exit.
				if (await this.canvasService.reloadIntoIde()) {
					return;
				}
				throw new Error(localize('positron.canvas.switchReloadRefused', "Positron did not reload. Try again or retry the switch."));
			}
			await restartExtensionHosts();
			await this.canvasService.exit();
			settle(lastError ?? cancelledError());
		};

		/** One recovery at a time; a failed one re-arms the card. */
		const runRecovery = async (action: () => Promise<void>) => {
			if (recovering || done.isSettled) {
				return;
			}
			recovering = true;
			try {
				await action();
			} catch (error) {
				this.logService.error('[canvas] Could not recover from the failed workspace switch', error);
				showFailure(error);
			} finally {
				recovering = false;
			}
		};

		// Canvas leaving while the card is up (exit command, native close):
		// a rebuild in flight settles the transaction itself; an idle card
		// has nobody else to do it.
		disposables.add(this.canvasService.onDidChangeActive(active => {
			if (active || rebuildInFlight || recovering || done.isSettled) {
				return;
			}
			restartExtensionHosts()
				.catch(error => this.logService.error('[canvas] Could not restart the extension hosts after Canvas closed mid-switch', error))
				.finally(() => settle(cancelledError()));
		}));

		void advance();
		return done.p;
	}

	/** Every editor outside the Canvas window, by the group holding it. */
	private captureSourceEditors(): Map<IEditorGroup, EditorInput[]> {
		const captured = new Map<IEditorGroup, EditorInput[]>();
		for (const group of this.editorGroupsService.groups) {
			if (!group.editors.some(editor => editor instanceof CanvasPlaceholderInput)) {
				captured.set(group, group.editors.slice());
			}
		}
		return captured;
	}

	/**
	 * Opening a folder starts from that folder's editors, not the last
	 * one's. Closes what the source had open, by group, so a destination
	 * editor that shares an input with the source is never touched, then
	 * lets detached windows left empty go.
	 */
	private async closeSourceEditors(sourceEditors: Map<IEditorGroup, EditorInput[]>): Promise<void> {
		for (const [group, editors] of sourceEditors) {
			// A group the destination's layout replaced is a different object.
			if (this.editorGroupsService.getGroup(group.id) !== group) {
				continue;
			}
			const open = editors.filter(editor => group.contains(editor));
			if (open.length > 0 && !await group.closeEditors(open, { preserveFocus: true })) {
				throw new Error(localize('positron.canvas.switchEditorsOpen', "An editor in the Positron window could not be closed."));
			}
		}
		for (const part of this.editorGroupsService.parts) {
			if (part === this.editorGroupsService.mainPart || !isAuxiliaryEditorPart(part)) {
				continue;
			}
			if (part.groups.some(group => group.editors.some(editor => editor instanceof CanvasPlaceholderInput))) {
				continue;
			}
			if (part.groups.every(group => group.count === 0)) {
				part.close();
			}
		}
	}
}

/** In-flight switch, so a second request cannot interleave with the first. */
let switching: Promise<void> | undefined;

CommandsRegistry.registerCommand(SWITCH_CANVAS_FOLDER_COMMAND_ID, (accessor: ServicesAccessor, folderPath?: unknown): Promise<void> => {
	if (typeof folderPath !== 'string') {
		throw new Error(`${SWITCH_CANVAS_FOLDER_COMMAND_ID}: folderPath must be a string`);
	}
	if (switching) {
		throw new Error(localize('positron.canvas.switchInProgress', "Canvas is already switching workspaces."));
	}
	const switcher = accessor.get(IInstantiationService).createInstance(CanvasFolderSwitcher);
	switching = switcher.switchFolder(folderPath).finally(() => {
		switching = undefined;
	});
	return switching;
});

/** Local folders from the recently opened list, most recent first, as paths. */
CommandsRegistry.registerCommand(GET_CANVAS_FOLDERS_COMMAND_ID, async (accessor: ServicesAccessor): Promise<string[]> => {
	const recents = await accessor.get(IWorkspacesService).getRecentlyOpened();
	return recents.workspaces
		.filter(isRecentFolder)
		.filter(recent => recent.folderUri.scheme === Schemas.file)
		.map(recent => recent.folderUri.fsPath);
});
