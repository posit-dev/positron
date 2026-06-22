/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageRuntimePackage } from '../../../services/runtimeSession/common/runtimeSessionService.js';

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
 * and is only consulted to decide whether a website action is available.
 */
export function derivePackageViewState(
	pkg: ILanguageRuntimePackage | undefined,
	ctx: PackageViewContext
): PackageViewState {
	const website: PackageAction[] = pkg?.url ? ['website'] : [];

	if (!ctx.sessionAlive) {
		return { installState: 'session-ended', actionsEnabled: false, actions: [...website], showNotActiveHint: false };
	}

	const actionsEnabled = ctx.isActive;
	const showNotActiveHint = !ctx.isActive;

	if (!ctx.installed) {
		return { installState: 'not-installed', actionsEnabled, actions: ['install', 'help', ...website], showNotActiveHint };
	}
	if (pkg?.outdated) {
		return { installState: 'outdated', actionsEnabled, actions: ['update', 'uninstall', 'help', ...website], showNotActiveHint };
	}
	return { installState: 'current', actionsEnabled, actions: ['uninstall', 'help', ...website], showNotActiveHint };
}
