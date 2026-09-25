/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../../base/common/async.js';
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
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustManagementService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { ICanvasFolderResolution, ICanvasFolderWorkspaceService } from '../../../../platform/workspaces/common/positronFolderWorkspace.js';
import { isRecentFolder, IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { IPositronCanvasService } from './positronCanvasService.js';

/**
 * Experimental command seam for Posit Assistant's Canvas workspace picker;
 * see ../README.md. `positron.experimental.*` rather than `positron.canvas.*`
 * because the shape may still change with the picker.
 */
export const SWITCH_CANVAS_FOLDER_COMMAND_ID = 'positron.experimental.switchCanvasFolder';
export const GET_CANVAS_FOLDERS_COMMAND_ID = 'positron.experimental.getCanvasFolders';

/**
 * How long one session's shutdown may take behind the curtains. A kernel can
 * exit without answering the shutdown request (the supervisor then drops the
 * request unanswered), and a shutdown can hang in the extension; without a
 * bound the user would be stuck behind inert curtains.
 */
const SESSION_SHUTDOWN_TIMEOUT = 10_000;

/**
 * Opens another folder in the Canvas window: an ordinary folder load into
 * this window, flagged so the new folder boots straight into Canvas.
 *
 * Two halves. The initial preflight runs first and changes nothing: every
 * refusal there rejects with a user-presentable message for the caller (the
 * assistant's picker) to show, with sessions, storage and windows as they
 * were. Then, behind the Canvas service's loading presentation, the runtime
 * sessions are shut down one by one (they belong to the folder being left)
 * and the main process is asked to load the folder. A refusal in this second
 * half (a session that turned busy or arrived, a shutdown that failed or was
 * declined, the folder changing, an unload veto) also rejects, and Canvas is
 * put back as it was on screen, but the sessions already shut down stay shut
 * down; the message names the session that stopped the request, not the
 * ones already gone. Once the load is accepted the document goes away, and
 * the new folder's own startup owns what happens next.
 */
export class CanvasFolderSwitcher {

	private readonly folderService: ICanvasFolderWorkspaceService;

	constructor(
		@IPositronCanvasService private readonly canvasService: IPositronCanvasService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IRuntimeSessionService private readonly runtimeSessionService: IRuntimeSessionService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IWorkspaceTrustManagementService private readonly trustService: IWorkspaceTrustManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
		@INativeHostService nativeHostService: INativeHostService,
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		this.folderService = ProxyChannel.toService<ICanvasFolderWorkspaceService>(mainProcessService.getChannel('workspaces'), { context: nativeHostService.windowId });
	}

	/**
	 * @param folderPath absolute local path. Resolves without doing anything
	 * when it names the current folder; rejects with a presentable message
	 * when the request is refused, or when the main process declined to load
	 * the folder (an unload veto) and Canvas was put back.
	 */
	async switchFolder(folderPath: string): Promise<void> {
		// Read live: `ai.enabled` toggles without a reload, and the new
		// folder's Canvas startup needs the assistant.
		if (this.configurationService.getValue<boolean>(AI_ENABLED_KEY) === false) {
			throw new Error(localize('positron.canvas.switchAiDisabled', "Canvas is unavailable because AI features are disabled."));
		}
		if (!this.canvasService.isActive) {
			throw new Error(localize('positron.canvas.switchNotPresenting', "Canvas is not open in its own window."));
		}
		const source = this.currentFolder();

		if (!isAbsolute(folderPath)) {
			throw new Error(localize('positron.canvas.switchAbsolute', "Canvas needs an absolute folder path to switch to."));
		}
		const target = URI.file(folderPath);

		// Main-process validation (exists, is a folder, not open in another
		// window) decides identity the way an ordinary open does, and
		// separately reports the physical folder behind any symlink.
		const resolution = await this.folderService.resolveCanvasFolder(target);
		if (isEqual(resolution.workspace.uri, source)) {
			return;
		}
		await this.requireTrusted(resolution, folderPath);

		// Dirty editors would need a save prompt inside the covered IDE, and
		// hot exit would carry their backups into a folder they do not belong
		// to.
		this.requireClean();

		// Shutting down a busy session asks whether to interrupt it, in the
		// covered IDE window, and a session still starting or restarting
		// would be dropped without its kernel being stopped; refuse both
		// instead of waiting behind the curtain.
		for (const session of this.runtimeSessionService.activeSessions) {
			this.requireSettled(session);
		}

		await this.canvasService.openFolderWithLoadingPresentation(stillPresenting => this.prepareAndOpen(target, folderPath, stillPresenting));
	}

	/**
	 * The half that runs behind the curtains. Sessions start in the
	 * workspace folder, so the new folder gets fresh ones; the supervisor
	 * would otherwise keep them across the load. Then the ordinary open.
	 *
	 * Sessions are read live, not from one snapshot: a runtime can finish
	 * starting while an earlier shutdown is awaited, and the curtains block
	 * the user, not background extension activity. Two passes over the live
	 * list cover a session that arrived mid-deletion; anything still there
	 * after that, or arriving during the final checks, refuses the load. A
	 * refusal here is not a no-op: sessions already shut down stay down.
	 */
	private async prepareAndOpen(target: URI, folderPath: string, stillPresenting: () => boolean): Promise<void> {
		this.requireLive(stillPresenting);
		for (let pass = 0; pass < 2 && this.runtimeSessionService.activeSessions.length > 0; pass++) {
			for (const session of [...this.runtimeSessionService.activeSessions]) {
				// Rechecked per session: an earlier shutdown can leave a
				// dependent session busy.
				this.requireSettled(session);
				let deleted: boolean | undefined;
				try {
					deleted = await raceTimeout(this.runtimeSessionService.deleteSession(session.sessionId), SESSION_SHUTDOWN_TIMEOUT);
				} catch (cause) {
					this.logService.error(`[canvas] Could not shut down the ${session.dynState.sessionName} session for the folder open`, cause);
					throw new Error(localize('positron.canvas.switchSessionFailed', "The {0} session could not be shut down.", session.dynState.sessionName), { cause });
				}
				if (deleted === undefined) {
					this.logService.error(`[canvas] The ${session.dynState.sessionName} session did not shut down within ${SESSION_SHUTDOWN_TIMEOUT}ms for the folder open`);
					throw new Error(localize('positron.canvas.switchSessionTimeout', "The {0} session did not shut down in time. Try again.", session.dynState.sessionName));
				}
				if (!deleted) {
					throw new Error(localize('positron.canvas.switchSession', "Shutting down the {0} session was cancelled.", session.dynState.sessionName));
				}
				this.requireLive(stillPresenting);
			}
		}
		this.requireNoSessions();

		// Preparation took time; the cheap checks again before the load.
		this.currentFolder();
		this.requireClean();
		const resolution = await this.folderService.resolveCanvasFolder(target);
		await this.requireTrusted(resolution, folderPath);
		this.requireLive(stillPresenting);
		this.requireNoSessions();

		await this.folderService.openCanvasFolder(target);
	}

	private currentFolder(): URI {
		if (this.environmentService.remoteAuthority || this.contextService.getWorkbenchState() !== WorkbenchState.FOLDER) {
			throw new Error(localize('positron.canvas.switchWorkspaceShape', "Canvas can only switch folders from a local, single-folder workspace."));
		}
		return this.contextService.getWorkspace().folders[0].uri;
	}

	/**
	 * Trust is decided per folder and the prompt renders in the IDE window;
	 * an untrusted destination is refused rather than asked. Checked on the
	 * logical path (what the workspace becomes) and on the physical one
	 * (what a symlink would otherwise let it dodge).
	 */
	private async requireTrusted({ workspace, physicalUri }: ICanvasFolderResolution, folderPath: string): Promise<void> {
		for (const uri of isEqual(workspace.uri, physicalUri) ? [workspace.uri] : [workspace.uri, physicalUri]) {
			if (!(await this.trustService.getUriTrustInfo(uri)).trusted) {
				throw new Error(localize('positron.canvas.switchUntrusted', "The folder {0} is not trusted. Open it in Positron first to trust it.", folderPath));
			}
		}
	}

	private requireClean(): void {
		if (this.workingCopyService.hasDirty) {
			throw new Error(localize('positron.canvas.switchDirty', "Save or discard your unsaved changes before switching folders."));
		}
	}

	/**
	 * A session the shutdown can handle: idle or ready (shut down) or already
	 * exited (removed). Busy would prompt in the covered IDE; every other
	 * state (starting, restarting, exiting, offline, interrupting) is deleted
	 * without its kernel being stopped, so it is refused until it settles.
	 */
	private requireSettled(session: ILanguageRuntimeSession): void {
		const state = session.getRuntimeState();
		if (state === RuntimeState.Busy) {
			throw new Error(localize('positron.canvas.switchBusySession', "The {0} session is busy. Wait for it to finish or interrupt it before switching folders.", session.dynState.sessionName));
		}
		if (state !== RuntimeState.Idle && state !== RuntimeState.Ready && state !== RuntimeState.Exited) {
			throw new Error(localize('positron.canvas.switchSessionUnsettled', "The {0} session is {1}. Wait for it to settle before switching folders.", session.dynState.sessionName, state));
		}
	}

	/** No runtime session may still be running when the load is requested. */
	private requireNoSessions(): void {
		const remaining = this.runtimeSessionService.activeSessions.at(0);
		if (remaining) {
			throw new Error(localize('positron.canvas.switchSessionArrived', "The {0} session started while switching folders. Wait for it, then try again.", remaining.dynState.sessionName));
		}
	}

	/**
	 * The Canvas this request started from is still up and no shutdown is
	 * under way; checked after every await. `stillPresenting` comes from the
	 * Canvas service and, unlike `isActive`, stays false across an exit
	 * followed by a re-entry.
	 */
	private requireLive(stillPresenting: () => boolean): void {
		if (this.lifecycleService.willShutdown) {
			throw new Error(localize('positron.canvas.switchShuttingDown', "Positron is shutting down."));
		}
		if (!stillPresenting()) {
			throw new Error(localize('positron.canvas.switchCancelled', "Canvas was closed while switching folders."));
		}
	}
}

/** In-flight request, so a second one cannot interleave with the first. */
let switching: Promise<void> | undefined;

CommandsRegistry.registerCommand(SWITCH_CANVAS_FOLDER_COMMAND_ID, (accessor: ServicesAccessor, folderPath?: unknown): Promise<void> => {
	if (typeof folderPath !== 'string') {
		throw new Error(localize('positron.canvas.switchArgument', "Canvas needs a folder path to switch to."));
	}
	if (switching) {
		throw new Error(localize('positron.canvas.switchInProgress', "Canvas is already switching folders."));
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
