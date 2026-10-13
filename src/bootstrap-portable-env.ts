/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Portable mode environment handling for configurePortable() in bootstrap-node.ts.
// Like bootstrap-node.ts, this file must not import anything from vs/.

type Env = Record<string, string | undefined>;

/**
 * Returns the portable data path set explicitly through the environment.
 * POSITRON_PORTABLE takes precedence; VSCODE_PORTABLE is a deprecated fallback.
 */
export function getPortableEnvOverride(env: Env): string | undefined {
	return env.POSITRON_PORTABLE || env.VSCODE_PORTABLE || undefined;
}

/**
 * Normalizes the portable mode signal to POSITRON_PORTABLE, the only name the
 * rest of Positron's processes see. VSCODE_PORTABLE is always removed: if it
 * survived in the non-portable case, the read sites' fallback would treat the
 * app as portable.
 */
export function normalizePortableEnv(env: Env, portableDataPath: string, isPortable: boolean): void {
	delete env.VSCODE_PORTABLE;
	if (isPortable) {
		env.POSITRON_PORTABLE = portableDataPath;
	} else {
		delete env.POSITRON_PORTABLE;
	}
}
