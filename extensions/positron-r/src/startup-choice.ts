/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// No `vscode` import here, so these functions can be unit tested with Vitest.

import * as semver from 'semver';

/**
 * The parts of an R installation that decide which R starts.
 */
export interface RStartupCandidate {
	readonly usable: boolean;
	readonly current: boolean;
	readonly semVersion: semver.SemVer;
	readonly arch: string;
}

/**
 * The order R installations are listed in: the current R first, then by
 * version, highest first. Two installations with the same version list arm64
 * before x86_64.
 */
export function compareRInstallations(a: RStartupCandidate, b: RStartupCandidate): number {
	if (a.current || b.current) {
		return Number(b.current) - Number(a.current);
	}
	// 'arm64' sorts before 'x86_64'
	return semver.compare(b.semVersion, a.semVersion) || a.arch.localeCompare(b.arch);
}
