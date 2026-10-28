/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface SessionLessStaticRouteInputs {
	isWorkbench: boolean;
	hasStaticRoute: boolean;
	/** This build's product.json `quality`. */
	quality: string | undefined;
	/** This build's product.json `commit`. */
	sessionCommit: string | undefined;
	/** Workbench is new enough (2026.11+) to set the static commit on every preview session. */
	workbenchSendsPreviewCommit: boolean;
	/** POSITRON_WORKBENCH_STATIC_COMMIT; present only on Positron preview sessions. */
	workbenchStaticCommit: string | undefined;
}

// Session-less asset URLs are served by Workbench's nginx from Workbench's own Positron install, so
// they are only safe when this session runs that same build.
export function shouldUseSessionLessStaticRoute(inputs: SessionLessStaticRouteInputs): boolean {
	if (!inputs.isWorkbench || !inputs.hasStaticRoute) {
		return false;
	}
	if (!inputs.workbenchSendsPreviewCommit) {
		// Older Workbench: can't tell preview sessions apart, so assume daily builds are skewed.
		return inputs.quality !== 'dailies';
	}
	if (!inputs.workbenchStaticCommit) {
		// Non-preview session: this is the Positron build Workbench selected and serves.
		return true;
	}
	// Preview session: only safe if the preview build happens to be the one nginx serves.
	return inputs.workbenchStaticCommit === inputs.sessionCommit;
}

export function shouldUseSessionLessStaticCallbackRoute(isWorkbench: boolean, hasStaticRoute: boolean): boolean {
	return isWorkbench && hasStaticRoute;
}
