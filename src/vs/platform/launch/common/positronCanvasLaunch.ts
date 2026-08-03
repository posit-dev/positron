/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The part of a window this decision reads: whether the window was opened with
 * Canvas already in its startup configuration.
 */
export interface ICanvasLaunchCandidate {
	readonly config: { readonly canvas?: boolean } | undefined;
}

/**
 * Which window, if any, should be told to open Canvas after a forwarded
 * `--canvas` launch.
 *
 * A forwarded `--canvas` is one request, so at most one window may act on it.
 * Windows this launch opened carry `canvas` in their configuration and enter
 * through the startup contribution, which waits for editor groups to restore
 * before looking for an existing Canvas panel; the action path runs as soon as
 * the workbench is ready and would scan pre-restore groups, find nothing, and
 * ask for a second panel. So a window that already carries the flag is left
 * alone, and only a reused window, which consumed its startup arguments on a
 * previous launch and has no other way to hear the request, gets the action.
 *
 * The last active window wins when the launch touched several, matching how a
 * forwarded chat request picks its window; otherwise the first is the only
 * candidate anyway.
 */
export function selectCanvasLaunchWindow<T extends ICanvasLaunchCandidate>(
	usedWindows: readonly T[],
	lastActiveWindow: T | undefined
): T | undefined {
	const candidate = lastActiveWindow && usedWindows.includes(lastActiveWindow)
		? lastActiveWindow
		: usedWindows.at(0);

	if (!candidate || candidate.config?.canvas) {
		return undefined;
	}

	return candidate;
}
