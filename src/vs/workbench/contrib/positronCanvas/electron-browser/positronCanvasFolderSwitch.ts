/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Schemas } from '../../../../base/common/network.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ISingleFolderWorkspaceIdentifier, IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderWorkspaceService } from '../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IAuxiliaryWindow, IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { WorkspaceService } from '../../../services/configuration/browser/configurationService.js';
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ITextEditorService } from '../../../services/textfile/common/textEditorService.js';
import { IWorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackup.js';
import { WorkingCopyBackupService } from '../../../services/workingCopy/common/workingCopyBackupService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CanvasSwitchCurtain } from '../browser/canvasSwitchCurtain.js';
import { CANVAS_MODE_STORAGE_KEY, CANVAS_WEBVIEW_VIEW_TYPE } from '../common/positronCanvasMode.js';
import { CANVAS_ENSURE_COMMAND, IPositronCanvasService } from './positronCanvasService.js';

/**
 * Experimental command seam for Posit Assistant's Canvas workspace picker;
 * see ../README.md. `positron.experimental.*` rather than `positron.canvas.*`
 * because the shape may still change with the picker.
 */
export const SWITCH_CANVAS_FOLDER_COMMAND_ID = 'positron.experimental.switchCanvasFolder';
export const GET_CANVAS_FOLDERS_COMMAND_ID = 'positron.experimental.getCanvasFolders';

/**
 * Cap on waiting for the assistant to rebuild Canvas after the extension
 * hosts restarted: activation from cold plus the assistant's own 14s ensure
 * deadline.
 */
const CANVAS_REBUILD_TIMEOUT = 30_000;

/** The Canvas panel being presented, and where. */
interface IPresentedCanvas {
	readonly group: IEditorGroup;
	readonly window: IAuxiliaryWindow;
	readonly editor: WebviewInput;
}

function isCanvasEditor(editor: EditorInput): editor is WebviewInput {
	return editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE;
}

/**
 * Switches the folder a Canvas window presents without leaving Canvas mode:
 * the same native window and renderer take on a new workspace identity, and
 * the assistant rebuilds Canvas inside it.
 *
 * Two halves. Everything that can refuse the switch runs first and changes
 * nothing, rejecting with a user-presentable message for the caller (the
 * assistant's picker) to show. Then a transaction of three steps runs behind
 * a curtain in the Canvas window: detach (close Canvas, shut runtimes and
 * extension hosts down), commit (the folder identity in main process,
 * workspace, storage, backups, recents) and restore (extension hosts back up,
 * Canvas rebuilt and moved home). A step failing stops the transaction where
 * it is; the curtain's Retry Canvas resumes from that step and Open Positron
 * hands the user the IDE in a consistent state. The caller cannot observe
 * failures past detach: its extension host is gone by then.
 */
export class CanvasFolderSwitcher {

	private readonly folderService: ICanvasFolderWorkspaceService;
	private readonly workspaceService: WorkspaceService;

	constructor(
		@IPositronCanvasService private readonly canvasService: IPositronCanvasService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@ITextEditorService private readonly textEditorService: ITextEditorService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ICommandService private readonly commandService: ICommandService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkingCopyBackupService private readonly workingCopyBackupService: IWorkingCopyBackupService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IWorkspaceTrustManagementService private readonly trustService: IWorkspaceTrustManagementService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IHostService private readonly hostService: IHostService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
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
	 * @param folderPath absolute local path; when omitted the user picks one
	 * in a native folder dialog over the Canvas window. Resolves without doing
	 * anything when the pick is cancelled or names the current folder.
	 */
	async switchFolder(folderPath?: string): Promise<void> {
		// Read live: `ai.enabled` toggles without a reload, and restoring
		// Canvas asks the assistant for a panel.
		if (this.configurationService.getValue<boolean>(AI_ENABLED_KEY) === false) {
			throw new Error(localize('positron.canvas.switchAiDisabled', "Canvas is unavailable because AI features are disabled."));
		}
		const presented = this.findPresentedCanvas();
		const source = this.currentFolder();

		if (folderPath !== undefined && !isAbsolute(folderPath)) {
			throw new Error(localize('positron.canvas.switchAbsolute', "Canvas needs an absolute folder path to switch to."));
		}
		const requested = folderPath !== undefined ? URI.file(folderPath) : await this.pickFolder(source);
		if (!requested) {
			return;
		}

		// Main-process validation (exists, is a folder, not open in another
		// window) also canonicalizes, so "same folder" is decided on identity.
		const target = await this.folderService.resolveCanvasFolder(requested);
		if (isEqual(target.uri, source)) {
			return;
		}

		// Trust is decided per folder and the prompt renders in the hidden
		// IDE window; an untrusted destination is refused rather than asked.
		if (!(await this.trustService.getUriTrustInfo(target.uri)).trusted) {
			throw new Error(localize('positron.canvas.switchUntrusted', "The folder {0} is not trusted. Open it in Positron first to trust it.", target.uri.fsPath));
		}

		// Dirty editors would need a save prompt inside the hidden IDE, and
		// their backups belong to the folder being left.
		if (this.workingCopyService.hasDirty) {
			throw new Error(localize('positron.canvas.switchDirty', "Save or discard your unsaved changes before switching workspaces."));
		}

		await this.transition(presented, target);
	}

	private findPresentedCanvas(): IPresentedCanvas {
		const group = this.canvasService.isActive ? this.canvasService.activeGroup : undefined;
		const part = group && this.editorGroupsService.getPart(group);
		const window = part && this.auxiliaryWindowService.getWindow(part.windowId);
		const editor = group?.editors.find(isCanvasEditor);
		if (!group || !window || !editor) {
			throw new Error(localize('positron.canvas.switchNotPresenting', "Canvas is not open in its own window."));
		}
		return { group, window, editor };
	}

	private currentFolder(): URI {
		if (this.environmentService.remoteAuthority || this.workspaceService.getWorkbenchState() !== WorkbenchState.FOLDER) {
			throw new Error(localize('positron.canvas.switchWorkspaceShape', "Canvas can only switch folders from a local, single-folder workspace."));
		}
		return this.workspaceService.getWorkspace().folders[0].uri;
	}

	private async pickFolder(source: URI): Promise<URI | undefined> {
		const picked = await this.fileDialogService.showOpenDialog({
			title: localize('positron.canvas.switchPickTitle', "Open Canvas Workspace"),
			defaultUri: source,
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false
		});
		return picked?.[0];
	}

	private async transition({ group, window, editor }: IPresentedCanvas, target: ISingleFolderWorkspaceIdentifier): Promise<void> {
		const curtain = new CanvasSwitchCurtain(window.container);
		let placeholder: EditorInput | undefined;
		let extensionHostsStopped = false;
		/**
		 * `partial` means the main process may hold the new identity while
		 * this renderer does not yet match it: the only state a reload, not
		 * an exit, recovers from.
		 */
		let commit: 'pending' | 'partial' | 'done' = 'pending';

		const detach = async () => {
			// An empty group closes its window and takes Canvas mode with
			// it; a placeholder keeps the window alive while Canvas is gone.
			placeholder ??= this.textEditorService.createTextEditor({ resource: URI.from({ scheme: Schemas.untitled, path: 'canvas-workspace-switch' }) });
			await group.openEditor(placeholder, { pinned: true, preserveFocus: true });
			if (!group.contains(placeholder)) {
				throw new Error(localize('positron.canvas.switchNoPlaceholder', "The Canvas window could not be prepared."));
			}
			if (group.contains(editor)) {
				await group.closeEditor(editor, { preserveFocus: true });
			}

			// Sessions start in the workspace folder, so the destination
			// gets fresh ones. Each shutdown can be declined.
			for (const session of [...this.runtimeSessionService.activeSessions]) {
				if (!await this.runtimeSessionService.deleteSession(session.sessionId)) {
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
			// The folder being left must stop claiming Canvas mode before
			// its storage closes: a relaunch of it should open the IDE.
			this.storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
			// Atomic in the main process: it either holds the new identity
			// from here on or refused and still holds the old one.
			const result = await this.folderService.enterCanvasFolder(target.uri);
			commit = 'partial';
			await this.workspaceService.initialize(result.workspace);
			await this.storageService.switch(result.workspace, false);
			if (this.workingCopyBackupService instanceof WorkingCopyBackupService) {
				// Same derivation as the service's construction from the
				// window configuration.
				this.workingCopyBackupService.reinitialize(result.backupPath ? URI.file(result.backupPath).with({ scheme: this.environmentService.userRoamingDataHome.scheme }) : undefined);
			}
			await this.workspacesService.addRecentlyOpened([{ folderUri: result.workspace.uri }]);
			commit = 'done';
		};

		const restore = async () => {
			if (extensionHostsStopped) {
				await this.extensionService.startExtensionHosts();
				extensionHostsStopped = false;
			}

			// The assistant creates the panel in the active group. Unlocking
			// lets that be this group, so the panel needs no second webview
			// move; the lock is Canvas mode's and goes back either way.
			group.focus();
			const wasLocked = group.isLocked;
			group.lock(false);
			let ready: boolean | undefined;
			try {
				ready = await raceTimeout(this.commandService.executeCommand(CANVAS_ENSURE_COMMAND).then(() => true), CANVAS_REBUILD_TIMEOUT);
			} finally {
				group.lock(wasLocked);
			}
			if (!ready) {
				throw new Error(localize('positron.canvas.switchNotReady', "Canvas did not finish starting in the new workspace."));
			}

			const rebuilt = this.findRebuiltCanvas(group, editor);
			if (!rebuilt) {
				throw new Error(localize('positron.canvas.switchNoPanel', "Canvas did not open in the new workspace."));
			}
			if (rebuilt.group !== group && !rebuilt.group.moveEditors(prepareMoveCopyEditors(rebuilt.group, [rebuilt.editor]), group)) {
				throw new Error(localize('positron.canvas.switchNoMove', "Canvas could not return to its window."));
			}
			await group.openEditor(rebuilt.editor, { pinned: true, preserveFocus: true });
			if (placeholder) {
				await group.closeEditor(placeholder, { preserveFocus: true });
				placeholder = undefined;
			}

			// The mode flag follows the folder: the destination now relaunches
			// into Canvas, as the source did before `commitFolder` cleared it.
			this.storageService.store(CANVAS_MODE_STORAGE_KEY, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			group.focus();
		};

		const openPositron = async () => {
			if (commit === 'partial') {
				// Renderer and main process may disagree about the folder;
				// the main process wins on reload, so reload rather than exit.
				// The flag is cleared for whichever storage is current so the
				// reload lands in the IDE.
				this.storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
				await this.hostService.reload();
				curtain.dispose();
				return;
			}
			if (extensionHostsStopped) {
				await this.extensionService.startExtensionHosts();
				extensionHostsStopped = false;
			}
			await this.canvasService.exit();
			curtain.dispose();
		};

		const steps = [detach, commitFolder, restore];
		let next = 0;
		const advance = async (): Promise<void> => {
			curtain.showLoading();
			try {
				while (next < steps.length) {
					await steps[next]();
					next++;
				}
				curtain.dispose();
			} catch (error) {
				this.logService.error(`[canvas] Switching the Canvas workspace to ${target.uri.fsPath} stopped at step ${next + 1} of ${steps.length}`, error);
				curtain.showFailure(toErrorMessage(error), {
					retry: () => void advance(),
					openPositron: () => void openPositron().catch(cause => {
						this.logService.error('[canvas] Could not hand back the IDE after a failed workspace switch', cause);
						curtain.showFailure(toErrorMessage(cause), { retry: () => void advance(), openPositron: () => void openPositron() });
					})
				});
			}
		};
		await advance();
	}

	/**
	 * The panel the assistant just produced: any Canvas panel other than the
	 * one this switch closed, preferring one already in the Canvas group.
	 */
	private findRebuiltCanvas(home: IEditorGroup, closed: WebviewInput): { group: IEditorGroup; editor: WebviewInput } | undefined {
		const groups = [home, ...this.editorGroupsService.groups.filter(group => group !== home)];
		for (const group of groups) {
			const editor = group.editors.find((candidate): candidate is WebviewInput => candidate !== closed && !candidate.isDisposed() && isCanvasEditor(candidate));
			if (editor) {
				return { group, editor };
			}
		}
		return undefined;
	}
}

/** In-flight switch, so a second request cannot interleave with the first. */
let switching: Promise<void> | undefined;

CommandsRegistry.registerCommand(SWITCH_CANVAS_FOLDER_COMMAND_ID, (accessor: ServicesAccessor, folderPath?: unknown): Promise<void> => {
	if (folderPath !== undefined && typeof folderPath !== 'string') {
		throw new Error(`${SWITCH_CANVAS_FOLDER_COMMAND_ID}: folderPath must be a string when given`);
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
