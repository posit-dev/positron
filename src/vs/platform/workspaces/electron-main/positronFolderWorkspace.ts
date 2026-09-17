/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs, Stats } from 'fs';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IBackupMainService } from '../../backup/electron-main/backup.js';
import { INativeWindowConfiguration } from '../../window/common/window.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { findWindowOnWorkspaceOrFolder } from '../../windows/electron-main/windowsFinder.js';
import { isSingleFolderWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { ICanvasFolderResult } from '../common/positronFolderWorkspace.js';
import { getSingleFolderWorkspaceIdentifier } from '../node/workspaces.js';

/**
 * A window whose folder identity can be swapped in place: local, loaded, and
 * already presenting a single folder. Multi-root and empty windows carry
 * state (workspace file, untitled workspace) the swap does not migrate.
 */
type ISwitchableWindow = ICodeWindow & { readonly config: INativeWindowConfiguration };

function requireSwitchableWindow(window: ICodeWindow | undefined): ISwitchableWindow {
	if (!window?.isReady || !window.config || window.remoteAuthority || !isSingleFolderWorkspaceIdentifier(window.openedWorkspace)) {
		throw new Error(localize('positron.canvas.switchWindow', "Canvas can only switch folders from a local, single-folder window."));
	}
	return window as ISwitchableWindow;
}

/**
 * Validates a destination folder for `window` and returns its canonical
 * identifier. Pure: every rejection here leaves the window untouched.
 */
export async function resolveCanvasFolder(window: ICodeWindow | undefined, windows: ICodeWindow[], folder: URI): Promise<ISingleFolderWorkspaceIdentifier> {
	const target = requireSwitchableWindow(window);
	if (folder.scheme !== Schemas.file) {
		throw new Error(localize('positron.canvas.switchLocal', "Canvas can only switch to a local folder."));
	}

	// Canonical path: the same folder reached through a symlink must map to
	// the same workspace identity (and storage) as the direct path.
	let canonical: URI;
	let stat: Stats;
	try {
		canonical = URI.file(await fs.realpath(folder.fsPath));
		stat = await fs.stat(canonical.fsPath);
	} catch {
		throw new Error(localize('positron.canvas.switchMissing', "The folder {0} does not exist.", folder.fsPath));
	}
	if (!stat.isDirectory()) {
		throw new Error(localize('positron.canvas.switchNotFolder', "{0} is not a folder.", folder.fsPath));
	}

	// Two windows on one folder would share workspace storage and backups.
	const existing = findWindowOnWorkspaceOrFolder(windows, canonical);
	if (existing && existing.id !== target.id) {
		throw new Error(localize('positron.canvas.switchOpenElsewhere', "The folder {0} is already open in another Positron window.", folder.fsPath));
	}

	return getSingleFolderWorkspaceIdentifier(canonical, stat);
}

/**
 * Commits `folder` as the window's identity without focusing or reloading it.
 * The window's next reload or relaunch opens this folder; until then the
 * renderer is responsible for re-initializing itself to match.
 */
export async function enterCanvasFolder(window: ICodeWindow | undefined, windows: ICodeWindow[], backups: IBackupMainService, folder: URI): Promise<ICanvasFolderResult> {
	const workspace = await resolveCanvasFolder(window, windows, folder);
	const target = requireSwitchableWindow(window);

	// Mirrors how a fresh window gets its backup home: none while developing
	// an extension, otherwise a folder registered for restore on relaunch.
	const backupPath = target.config.extensionDevelopmentPath ? undefined : backups.registerFolderBackup({ folderUri: workspace.uri, remoteAuthority: undefined });
	target.config.workspace = workspace;
	target.config.backupPath = backupPath;
	return { workspace, backupPath };
}
