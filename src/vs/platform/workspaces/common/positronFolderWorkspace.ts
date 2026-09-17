/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { ISingleFolderWorkspaceIdentifier } from '../../workspace/common/workspace.js';

/**
 * What a folder request resolves to before anything changes.
 *
 * `workspace` is the logical identity: the requested path, normalized the
 * way an ordinary File > Open Folder normalizes it, so storage and recents
 * line up with the same folder opened any other way. `physicalUri` is where
 * that path leads on disk once symlinks are resolved; it can differ from
 * `workspace.uri` when the request came through an alias. The renderer
 * checks workspace trust on both, so a trusted alias of an untrusted folder
 * (or the reverse) is refused.
 */
export interface ICanvasFolderResolution {
	readonly workspace: ISingleFolderWorkspaceIdentifier;
	readonly physicalUri: URI;
}

/** What a window takes on when it switches to another folder. */
export interface ICanvasFolderResult {
	readonly workspace: ISingleFolderWorkspaceIdentifier;
	/** Undefined for extension development windows, which keep no backups. */
	readonly backupPath: string | undefined;
}

/**
 * Main-process half of a Canvas folder switch: the window keeps its native
 * window and renderer, only its workspace identity changes. Served on the
 * `workspaces` channel with the calling window's id as context, next to
 * `IWorkspacesService`. Experimental and desktop-only; see
 * `workbench/contrib/positronCanvas/README.md`.
 */
export interface ICanvasFolderWorkspaceService {

	/**
	 * Checks that `folder` can become the calling window's workspace and
	 * returns its logical identifier together with the physical location it
	 * resolves to. Changes nothing, so the renderer can reject a switch
	 * before it has taken anything down. Requesting the folder the window
	 * already shows, through any name, returns the current identifier.
	 * Rejects with a user-presentable message.
	 */
	resolveCanvasFolder(folder: URI): Promise<ICanvasFolderResolution>;

	/**
	 * Resolves `folder` and commits it as the calling window's workspace
	 * identity and backup home. Neither focuses nor reloads the window; a
	 * later reload or relaunch opens the new folder.
	 */
	enterCanvasFolder(folder: URI): Promise<ICanvasFolderResult>;
}
