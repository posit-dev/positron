/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { localize } from '../../../nls.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { isSingleFolderWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { IOpenConfiguration } from './windows.js';

/**
 * The routing decisions a Canvas folder open adds to the ordinary open path
 * (`IOpenConfiguration.positronCanvasFolderOpen`). Each is a no-op for an
 * ordinary open; with the option set, each turns a fallback the ordinary
 * path would take silently (open somewhere else, reuse a peer window, load
 * without waiting for the unload's answer) into a rejection the caller can
 * report. Kept out of `windowsMainService.ts` so the decisions are testable
 * without constructing the windows service.
 */

/** What the checks read from a window; `ICodeWindow` satisfies it. */
export type ICanvasFolderOpenWindow = Pick<ICodeWindow, 'id' | 'isReady' | 'remoteAuthority' | 'openedWorkspace'>;

/** A resolved path as `WindowsMainService.getPathsToOpen` returns it, reduced to what the check reads. */
export interface ICanvasFolderOpenPath {
	readonly workspace?: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier;
	readonly fileUri?: unknown;
	readonly backupPath?: string;
}

const sourceGone = () => new Error(localize('positron.canvas.openSourceGone', "The Positron window that asked to switch folders is no longer available."));

/**
 * After path resolution: the request must have resolved to exactly the
 * folder it asked for, and the window it is to load into must still be a
 * ready, local, single-folder window. Anything else (folder vanished,
 * resolved as something other than a folder, source window closed or
 * changed shape) rejects instead of letting the ordinary path open an
 * empty, new, or last-active window.
 */
export function assertCanvasFolderOpenTarget(openConfig: IOpenConfiguration, pathsToOpen: readonly ICanvasFolderOpenPath[], contextWindow: ICanvasFolderOpenWindow | undefined): void {
	const expected = openConfig.positronCanvasFolderOpen;
	if (!expected) {
		return;
	}

	const path = pathsToOpen.length === 1 ? pathsToOpen[0] : undefined;
	if (!path || !isSingleFolderWorkspaceIdentifier(path.workspace) || path.workspace.id !== expected.id || !extUriBiasedIgnorePathCase.isEqual(path.workspace.uri, expected.uri)) {
		throw new Error(localize('positron.canvas.openTargetChanged', "The folder {0} could not be opened: it changed or went away.", expected.uri.fsPath));
	}

	if (!contextWindow || contextWindow.id !== openConfig.contextWindowId || !contextWindow.isReady || contextWindow.remoteAuthority || !isSingleFolderWorkspaceIdentifier(contextWindow.openedWorkspace)) {
		throw sourceGone();
	}
}

/**
 * At the existing-window check: an ordinary open focuses a window that
 * already shows the folder and sends it the files. A Canvas folder open
 * must load, so a destination that turned out to be open (in any window,
 * the source included) rejects before that focus happens.
 */
export function rejectCanvasFolderOpenCollision(openConfig: IOpenConfiguration, windowsOnFolderPath: readonly ICanvasFolderOpenWindow[]): void {
	const expected = openConfig.positronCanvasFolderOpen;
	if (!expected || windowsOnFolderPath.length === 0) {
		return;
	}
	throw new Error(localize('positron.canvas.openTargetElsewhere', "The folder {0} is already open in another Positron window.", expected.uri.fsPath));
}

/**
 * The load itself. The ordinary path schedules `unload` and returns without
 * waiting for its answer, so its callers cannot learn about a veto; this
 * awaits it. A veto rejects with a presentable message and never loads.
 * Acceptance awaits `load` (backup registration, profile, then the window
 * load), so the returned promise settles only once the new load is under
 * way or has failed to start. `window` must be the window the request
 * targeted: anything else means the ordinary path fell back to a different
 * window, and the request rejects rather than loading into it.
 *
 * An accepted unload is not only permission: the window's workbench has
 * shut down by the time it resolves. If `load` then fails before the new
 * folder starts loading, the window is a shut-down document under a
 * loading curtain with nobody left to present the failure. `recover`
 * (an ordinary reload of the window into the folder it came from, as the
 * IDE) runs in that case so the user gets a live window back; the request
 * still rejects with the original error.
 *
 * The unload is shared: a quit or window close requested while it is
 * pending coalesces onto it and proceeds once it resolves. `canLoad`
 * (no quit requested, native window still there) is asked after the
 * unload resolves; when it says no, the load is skipped and the quit or
 * close goes ahead, rather than navigating a window that is on its way out.
 */
export async function loadCanvasFolderWindow(
	window: ICanvasFolderOpenWindow | undefined,
	expectedWindowId: number | undefined,
	unload: () => Promise<boolean /* veto */>,
	load: () => Promise<void>,
	recover: () => void,
	canLoad: () => boolean
): Promise<void> {
	if (!window || window.id !== expectedWindowId) {
		throw sourceGone();
	}
	const unloaded = window.isReady;
	if (unloaded && await unload()) {
		throw new Error(localize('positron.canvas.openVetoed', "Positron could not leave the current folder. Check for unsaved work or a task that is still running."));
	}
	if (!canLoad()) {
		return;
	}
	try {
		await load();
	} catch (error) {
		if (unloaded) {
			recover();
		}
		throw error;
	}
}
