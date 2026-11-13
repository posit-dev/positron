/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage, isBundledOnly } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/** The install/lifecycle state a package detail editor can be in. */
export type PackageInstallState = 'current' | 'outdated' | 'not-installed' | 'session-ended';

/** A button/affordance the detail header can show. */
export type PackageAction = 'update' | 'uninstall' | 'install' | 'help' | 'website';

export interface PackageViewState {
	/** Coarse install/lifecycle state, drives the header copy. */
	readonly installState: PackageInstallState;
	/** Whether package-manipulation actions (everything except website) are enabled. */
	readonly actionsEnabled: boolean;
	/** The ordered set of actions the header should render. */
	readonly actions: PackageAction[];
	/** Whether to show the "viewing a non-active session" hint banner. */
	readonly showNotActiveHint: boolean;
	/**
	 * Whether the runtime reports the environment's copy as the latest
	 * version. For a bundled package that is `environmentVersion`; a
	 * bundled-only package has no environment copy, so it is never latest.
	 */
	readonly latest: boolean;
}

export interface PackageViewContext {
	/** Whether the package is currently present in the bound session's installed list. */
	readonly installed: boolean;
	/** Whether the bound session is still alive (present in the packages service). */
	readonly sessionAlive: boolean;
	/** Whether the bound session is the currently active packages session. */
	readonly isActive: boolean;
}

/**
 * Pure mapping from package data + session context to the header's view state.
 * `pkg` is the last-known package data (may be retained after uninstall/session-end)
 * and is consulted to decide whether a website action is available and how the
 * installed copy relates to the user's environment.
 */
export function derivePackageViewState(
	pkg: ILanguageRuntimePackage | undefined,
	ctx: PackageViewContext
): PackageViewState {
	// Website before help, matching the order the Packages list uses. The list right-aligns
	// its icon group, so help (always present there) has to come last to stay pinned to the
	// row's right edge; the detail page follows that order so an icon does not swap position
	// when moving between the two views.
	const website: PackageAction[] = pkg?.url ? ['website'] : [];

	if (!ctx.sessionAlive) {
		return { installState: 'session-ended', actionsEnabled: false, actions: [...website], showNotActiveHint: false, latest: false };
	}

	const actionsEnabled = ctx.isActive;
	const showNotActiveHint = !ctx.isActive;

	if (!ctx.installed) {
		return { installState: 'not-installed', actionsEnabled, actions: ['install', ...website, 'help'], showNotActiveHint, latest: false };
	}
	// Only Positron's bundle provides the package: there is no environment
	// copy to update or uninstall, and outdated state does not apply.
	if (pkg && isBundledOnly(pkg)) {
		return { installState: 'current', actionsEnabled, actions: [...website, 'help'], showNotActiveHint, latest: false };
	}
	// For a bundled package the environment also has, outdated state and the
	// actions describe the environment's copy.
	const latest = pkg?.outdated === false;
	const updateActions: PackageAction[] = pkg?.outdated ? ['update', 'uninstall'] : ['uninstall'];
	const installState: PackageInstallState = pkg?.outdated ? 'outdated' : 'current';
	return { installState, actionsEnabled, actions: [...updateActions, ...website, 'help'], showNotActiveHint, latest };
}
