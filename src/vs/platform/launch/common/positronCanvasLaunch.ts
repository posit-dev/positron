/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** What this decision reads: whether the window was opened with `--canvas`. */
export interface ICanvasLaunchCandidate {
	readonly config: { readonly canvas?: boolean } | undefined;
}

export interface ICanvasLaunchArgs {
	readonly canvas?: boolean;
}

/** Assigns a `--canvas` launch to exactly one window configuration. */
export class CanvasLaunchWindowAssigner {

	private readonly assignedLaunches = new WeakSet<ICanvasLaunchArgs>();

	assign(args: ICanvasLaunchArgs | undefined): boolean {
		if (args?.canvas !== true || this.assignedLaunches.has(args)) {
			return false;
		}

		this.assignedLaunches.add(args);
		return true;
	}
}

/**
 * Which window, if any, should be told to open Canvas after a forwarded
 * `--canvas` launch. Last active wins. If any used window carries the flag,
 * no action is sent: it enters through the startup contribution, which waits
 * for editor groups to restore; the action path would scan pre-restore groups
 * and ask for a second panel.
 */
export function selectCanvasLaunchWindow<T extends ICanvasLaunchCandidate>(
	usedWindows: readonly T[],
	lastActiveWindow: T | undefined
): T | undefined {
	if (usedWindows.some(window => window.config?.canvas)) {
		return undefined;
	}

	const candidate = lastActiveWindow && usedWindows.includes(lastActiveWindow)
		? lastActiveWindow
		: usedWindows.at(0);

	return candidate;
}
