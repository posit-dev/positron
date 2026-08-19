/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../base/common/path.js';

/**
 * The parsed arguments a `--canvas` launch travels in. `canvas` is mutable
 * on purpose: `assign()` consumes the flag by deleting it, so later reads of
 * the same launch cannot re-grant Canvas.
 */
export interface ICanvasLaunchArgs {
	canvas?: boolean;
}

/**
 * What identifies the window a configuration is being built for: a workspace
 * or single-folder workspace id, a restored empty window's backup folder, or
 * neither for a brand new empty window.
 */
export interface ICanvasWindowIdentity {
	readonly workspaceId: string | undefined;
	readonly backupFolder: string | undefined;
}

/** A path a launch is about to open, reduced to what identifies its window. */
export interface ICanvasLaunchPath {
	readonly workspace?: { readonly id: string };
	readonly backupPath?: string;
}

function toIdentity(path: ICanvasLaunchPath | undefined): ICanvasWindowIdentity {
	return {
		workspaceId: path?.workspace?.id,
		backupFolder: path?.backupPath ? basename(path.backupPath) : undefined
	};
}

/**
 * Assigns a `--canvas` launch to exactly one window configuration.
 *
 * `prime()` picks the target window up front, because configurations are
 * built in workspaces -> folders -> empty order, not request order:
 * first-come-first-served would hand Canvas to an arbitrary restored
 * background window. `assign()` grants Canvas only to the matching
 * configuration and consumes the flag off the args object itself, so a
 * stale flag cannot leak into later windows.
 *
 * Targets are keyed by the launch's args object (the one reference a launch
 * travels in from `prime()` to `assign()`), so an interleaved second open
 * cannot clobber another launch's target.
 */
export class CanvasLaunchWindowAssigner {

	private readonly targets = new WeakMap<ICanvasLaunchArgs, ICanvasWindowIdentity>();

	/**
	 * Chooses which of the windows about to open carries the launch's
	 * `--canvas`: the first requested window for a requested open, the
	 * last-active window (kept last in the restore list) for a restore.
	 */
	prime(args: ICanvasLaunchArgs | undefined, paths: readonly ICanvasLaunchPath[], restoring: boolean): void {
		if (args?.canvas !== true) {
			if (args) {
				this.targets.delete(args);
			}
			return;
		}

		// File-only paths open in whatever window takes the files; the ones
		// with a window identity of their own decide the target. None at all
		// means a fresh empty window (identity-less on both sides).
		const windowPaths = paths.filter(path => path.workspace || path.backupPath);
		this.targets.set(args, toIdentity(restoring ? windowPaths.at(-1) : windowPaths.at(0)));
	}

	assign(args: ICanvasLaunchArgs | undefined, identity: ICanvasWindowIdentity): boolean {
		if (args?.canvas !== true) {
			return false;
		}

		const target = this.targets.get(args);
		if (target && (target.workspaceId !== identity.workspaceId || target.backupFolder !== identity.backupFolder)) {
			return false;
		}

		// Consume the flag on success: no later window built from these args
		// may see it, and its absence tells the launch service the flag
		// reached a fresh window, so no forwarded action is needed.
		delete args.canvas;
		this.targets.delete(args);
		return true;
	}
}

/**
 * Which window, if any, should be told to open Canvas after a forwarded
 * `--canvas` launch. Only consulted while the launch still carries its flag,
 * meaning the launch reused windows only (a fresh window consumes it and
 * enters through the startup contribution). Last active wins.
 */
export function selectCanvasLaunchWindow<T>(
	usedWindows: readonly T[],
	lastActiveWindow: T | undefined
): T | undefined {
	return lastActiveWindow && usedWindows.includes(lastActiveWindow)
		? lastActiveWindow
		: usedWindows.at(0);
}
