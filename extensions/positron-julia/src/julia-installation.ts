/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver';

/**
 * How a Julia installation was discovered.
 */
export enum ReasonDiscovered {
	/** Found in PATH */
	PATH = 'PATH',
	/** Found via juliaup */
	JULIAUP = 'juliaup',
	/** Found in standard installation location */
	STANDARD = 'standard',
	/** User-configured path */
	USER_SETTING = 'user-setting',
}

/**
 * Represents a discovered Julia installation.
 */
export interface JuliaInstallation {
	/** Path to the julia executable */
	binpath: string;

	/** Julia home directory (JULIA_HOME) */
	homepath: string;

	/** Version string (e.g., "1.10.2") */
	version: string;

	/** Parsed semantic version */
	semVersion: semver.SemVer;

	/** Architecture (e.g., "aarch64", "x86_64") */
	arch: string;

	/** How this installation was discovered */
	reasonDiscovered: ReasonDiscovered;

	/** Whether this is the current/default Julia */
	current: boolean;
}

/**
 * Minimum supported Julia version.
 */
export const MIN_JULIA_VERSION = '1.9.0';

/**
 * Validates a Julia installation meets minimum requirements.
 */
export function isValidJuliaInstallation(installation: JuliaInstallation): boolean {
	return semver.gte(installation.semVersion, MIN_JULIA_VERSION);
}
