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

/**
 * Main-process half of opening another folder from Canvas: an ordinary
 * folder load into the calling window that carries a one-use "boot into
 * Canvas" intent. Served on the `workspaces` channel with the calling
 * window's id as context, next to `IWorkspacesService`. Experimental and
 * desktop-only; see `workbench/contrib/positronCanvas/README.md`.
 */
export interface ICanvasFolderWorkspaceService {

	/**
	 * Checks that `folder` can be loaded into the calling window and returns
	 * its logical identifier together with the physical location it resolves
	 * to. Changes nothing, so the renderer can reject a request before it has
	 * covered anything. Requesting the folder the window already shows,
	 * through any name, returns the current identifier. Rejects with a
	 * user-presentable message.
	 */
	resolveCanvasFolder(folder: URI): Promise<ICanvasFolderResolution>;

	/**
	 * Re-resolves `folder` and loads it into the calling window through the
	 * ordinary open path, with `--canvas` set for that one load. Resolves
	 * once the window's unload was accepted and the new load has started;
	 * rejects, with the window untouched, when the request is refused or the
	 * unload is vetoed. The caller's document goes away with the load, so it
	 * cannot await Canvas readiness in the new folder.
	 */
	openCanvasFolder(folder: URI): Promise<void>;
}
