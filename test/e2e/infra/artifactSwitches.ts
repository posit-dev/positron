/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep this file import-free: it is read before the harness exists.

export type ArtifactSwitch = 'E2E_TRACES' | 'E2E_ATTACH_LOGS' | 'E2E_ATTACH_CRASH_DUMPS';

/**
 * Whether an artifact that can carry secrets is produced. 'on' / 'off' (case-sensitive)
 * win; anything else defaults to off in CI and on locally.
 */
export function isArtifactEnabled(name: ArtifactSwitch, env: NodeJS.ProcessEnv = process.env): boolean {
	const value = env[name];
	if (value === 'on') { return true; }
	if (value === 'off') { return false; }
	return !env.CI;
}
