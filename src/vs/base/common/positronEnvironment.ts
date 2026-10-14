/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IProcessEnvironment } from './platform.js';

/**
 * The suffixes of the path override environment variables that Positron reads
 * as POSITRON_<name>, with VSCODE_<name> as a deprecated fallback.
 */
type PositronEnvName = 'EXTENSIONS' | 'PORTABLE' | 'APPDATA';

const positronEnvNames: readonly PositronEnvName[] = ['EXTENSIONS', 'PORTABLE', 'APPDATA'];

/**
 * Reads a POSITRON_* environment variable, falling back to its deprecated
 * VSCODE_* equivalent. POSITRON_* takes precedence when both are set.
 * Empty strings are treated as unset, matching the truthiness checks at
 * the read sites.
 */
export function getPositronEnv(env: IProcessEnvironment, name: PositronEnvName): string | undefined {
	return env[`POSITRON_${name}`] || env[`VSCODE_${name}`] || undefined;
}

/**
 * Returns the name of each deprecated VSCODE_* variable that is set while its
 * POSITRON_* counterpart is not, so that the value in effect comes from the
 * deprecated name.
 */
export function getDeprecatedEnvFallbacks(env: IProcessEnvironment): string[] {
	return positronEnvNames
		.filter(name => !env[`POSITRON_${name}`] && !!env[`VSCODE_${name}`])
		.map(name => `VSCODE_${name}`);
}

/**
 * The first Positron release that ignores the deprecated VSCODE_* names.
 * Update this if the removal schedule shifts.
 */
const deprecatedEnvRemovalRelease = '2027.01';

/**
 * Formats the log message for a deprecated VSCODE_* variable that is in use.
 */
export function formatDeprecatedEnvWarning(deprecatedName: string): string {
	const replacement = deprecatedName.replace(/^VSCODE_/, 'POSITRON_');
	return `${deprecatedName} is deprecated and will be ignored starting in Positron ${deprecatedEnvRemovalRelease}; set ${replacement} instead.`;
}
