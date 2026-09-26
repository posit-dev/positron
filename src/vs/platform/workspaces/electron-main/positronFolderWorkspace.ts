/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fsPromises, Stats } from 'fs';
import { sanitizeFilePath } from '../../../base/common/extpath.js';
import { Schemas } from '../../../base/common/network.js';
import { normalize } from '../../../base/common/path.js';
import { cwd } from '../../../base/common/process.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { NativeParsedArgs } from '../../environment/common/argv.js';
import { INativeWindowConfiguration } from '../../window/common/window.js';
import { ICodeWindow } from '../../window/electron-main/window.js';
import { IOpenConfiguration, OpenContext } from '../../windows/electron-main/windows.js';
import { findWindowOnWorkspaceOrFolder } from '../../windows/electron-main/windowsFinder.js';
import { isSingleFolderWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { ICanvasFolderResolution } from '../common/positronFolderWorkspace.js';
import { getSingleFolderWorkspaceIdentifier } from '../node/workspaces.js';

/**
 * A window another folder can be loaded into from Canvas: local, loaded, and
 * already presenting a single folder. Multi-root and empty windows carry
 * state (workspace file, untitled workspace) the request does not migrate.
 */
type ISwitchableWindow = ICodeWindow & { readonly config: INativeWindowConfiguration; readonly openedWorkspace: ISingleFolderWorkspaceIdentifier };

/** The filesystem calls the resolver makes, injectable so alias cases are testable without symlinks. */
export interface ICanvasFolderFs {
	readonly realpath: (path: string) => Promise<string>;
	readonly stat: (path: string) => Promise<Stats>;
}

const nodeFs: ICanvasFolderFs = { realpath: fsPromises.realpath, stat: fsPromises.stat };

function requireSwitchableWindow(window: ICodeWindow | undefined): ISwitchableWindow {
	if (!window?.isReady || !window.config || window.remoteAuthority || !isSingleFolderWorkspaceIdentifier(window.openedWorkspace)) {
		throw new Error(localize('positron.canvas.switchWindow', "Canvas can only switch folders from a local, single-folder window."));
	}
	return window as ISwitchableWindow;
}

/** The folder a local single-folder window presents, or undefined for any other kind of window. */
function localFolderOf(window: ICodeWindow): URI | undefined {
	return !window.remoteAuthority && isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && window.openedWorkspace.uri.scheme === Schemas.file
		? window.openedWorkspace.uri
		: undefined;
}

/**
 * Whether `folder` is the directory a request resolved to. Falls back to a
 * lexical comparison against both the requested and the physical path when
 * the folder cannot be resolved (unreadable, unmounted), so a broken folder
 * never blocks the check.
 */
async function isSameDirectory(folder: URI, requested: URI, physicalUri: URI, fs: ICanvasFolderFs): Promise<boolean> {
	try {
		return extUriBiasedIgnorePathCase.isEqual(URI.file(await fs.realpath(folder.fsPath)), physicalUri);
	} catch {
		return extUriBiasedIgnorePathCase.isEqual(folder, requested) || extUriBiasedIgnorePathCase.isEqual(folder, physicalUri);
	}
}

/**
 * Validates a destination folder for `window` and returns its identity.
 * Pure: every rejection here leaves the window untouched.
 *
 * Identity follows the upstream open path (the requested path, sanitized),
 * so a folder opened from Canvas shares storage and recents with the same
 * folder opened from File > Open Folder. The resolved physical path is used
 * only to compare against other windows and the current folder. Ordinary
 * filesystem races apply: the folder can still change between this check
 * and the open, which then fails the way any folder open would.
 */
export async function resolveCanvasFolder(window: ICodeWindow | undefined, windows: ICodeWindow[], folder: URI, fs: ICanvasFolderFs = nodeFs): Promise<ICanvasFolderResolution> {
	const target = requireSwitchableWindow(window);
	if (folder.scheme !== Schemas.file) {
		throw new Error(localize('positron.canvas.switchLocal', "Canvas can only switch to a local folder."));
	}

	// Mirrors WindowsMainService.doResolveFilePath: the same normalization an
	// ordinary open applies, so a trailing separator does not change the id.
	const requestedPath = sanitizeFilePath(normalize(folder.fsPath), cwd());
	let stat: Stats;
	try {
		stat = await fs.stat(requestedPath);
	} catch {
		throw new Error(localize('positron.canvas.switchMissing', "The folder {0} does not exist.", folder.fsPath));
	}
	if (!stat.isDirectory()) {
		throw new Error(localize('positron.canvas.switchNotFolder', "{0} is not a folder.", folder.fsPath));
	}

	const requested = URI.file(requestedPath);
	let physicalUri: URI;
	try {
		physicalUri = URI.file(await fs.realpath(requestedPath));
	} catch {
		physicalUri = requested;
	}

	// Same folder through another name: keep the current identity so the
	// renderer sees a no-op instead of a switch to itself.
	if (await isSameDirectory(target.openedWorkspace.uri, requested, physicalUri, fs)) {
		return { workspace: target.openedWorkspace, physicalUri };
	}

	// Two windows on one folder would share workspace storage and backups.
	// Lexical first (as upstream), then physical so an alias cannot slip past.
	const existing = findWindowOnWorkspaceOrFolder(windows, requested);
	if (existing && existing.id !== target.id) {
		throw new Error(localize('positron.canvas.switchOpenElsewhere', "The folder {0} is already open in another Positron window.", folder.fsPath));
	}
	for (const other of windows) {
		const otherFolder = other.id !== target.id ? localFolderOf(other) : undefined;
		if (otherFolder && await isSameDirectory(otherFolder, requested, physicalUri, fs)) {
			throw new Error(localize('positron.canvas.switchOpenElsewhere', "The folder {0} is already open in another Positron window.", folder.fsPath));
		}
	}

	return { workspace: getSingleFolderWorkspaceIdentifier(requested, stat), physicalUri };
}

/** What `openCanvasFolder` needs from the windows service and the environment. */
export interface ICanvasFolderOpener {
	/** The process arguments; read, never written. */
	readonly args: NativeParsedArgs;
	/** `IWindowsMainService.open`. */
	open(openConfig: IOpenConfiguration): Promise<ICodeWindow[]>;
}

/**
 * The launch arguments for one Canvas folder load: the process arguments
 * with every operand that names something to open or act on cleared, and
 * `--canvas` set. A fresh object per request, because
 * `CanvasLaunchWindowAssigner` keys its one-use target by the argument
 * object and consumes the flag off it.
 */
function canvasFolderLaunchArgs(args: NativeParsedArgs): NativeParsedArgs {
	return {
		...args,
		_: [],
		'folder-uri': undefined,
		'file-uri': undefined,
		wait: undefined,
		waitMarkerFilePath: undefined,
		chat: undefined,
		remote: undefined,
		diff: undefined,
		merge: undefined,
		add: undefined,
		remove: undefined,
		goto: undefined,
		'new-window': undefined,
		'reuse-window': undefined,
		canvas: true
	};
}

/**
 * Loads `folder` into `window` through the ordinary open path, flagged so
 * that one load boots into Canvas. Re-resolves rather than trusting the
 * renderer's earlier preflight: the folder or the other windows may have
 * changed in between. The open itself decides acceptance (see
 * `IOpenConfiguration.positronCanvasFolderOpen`); this only builds the
 * request and refuses what the resolver refuses.
 */
export async function openCanvasFolder(window: ICodeWindow | undefined, windows: ICodeWindow[], folder: URI, opener: ICanvasFolderOpener, fs: ICanvasFolderFs = nodeFs): Promise<void> {
	const { workspace } = await resolveCanvasFolder(window, windows, folder, fs);
	const target = requireSwitchableWindow(window);
	if (workspace === target.openedWorkspace) {
		// The renderer treats this as a no-op before it covers anything; by
		// the time a request reaches here it must not reload into itself.
		throw new Error(localize('positron.canvas.switchSameFolder', "Canvas is already showing the folder {0}.", folder.fsPath));
	}

	await opener.open({
		context: OpenContext.API,
		contextWindowId: target.id,
		urisToOpen: [{ folderUri: workspace.uri }],
		forceReuseWindow: true,
		cli: canvasFolderLaunchArgs(opener.args),
		positronCanvasFolderOpen: workspace
	});
}
