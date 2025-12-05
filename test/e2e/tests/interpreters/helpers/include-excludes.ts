/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { SessionRuntimes, Sessions } from '../../../pages/sessions.js';

/**
 * Helper function to build R path based on environment.
 * Reads version from POSITRON_R_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'customRoot', 'exclude', or 'override'
 */
export function buildRPath(usage: 'customRoot' | 'exclude' | 'override' = 'exclude'): string {
	const version = process.env.POSITRON_R_ALT_VER_SEL
	if (!version) {
		throw new Error('Environment variable POSITRON_R_ALT_VER_SEL not set');
	}
	const majorMinor = version.split('.').slice(0, 2).join('.');

	if (usage === 'customRoot') {
		// Custom root - the custom folder for R discovery
		return process.env.CI
			? '/root/scratch'
			: '/Users/runner/scratch'; // <-- modify for local testing
	} else if (usage === 'exclude') {
		// Exclude path - the standard R installation location for the version
		return process.env.CI
			? `/opt/R/${version}`
			: `/Library/Frameworks/R.framework/Versions/${majorMinor}-arm64`; // <-- modify for local testing
	} else {
		// Override path - the hidden R interpreter location
		return process.env.CI
			? `/root/scratch/r-env/bin/R`
			: `/Users/runner/scratch/r-env/bin/R`; // <-- modify for local testing
	}
}

/**
 * Helper function to build Python path based on environment.
 * Reads version from POSITRON_PY_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'include', 'exclude', or 'override'
 */
export function buildPythonPath(usage: 'include' | 'exclude' | 'override' = 'exclude'): string {
	const version = process.env.POSITRON_PY_ALT_VER_SEL;
	if (!version) {
		throw new Error('Environment variable POSITRON_PY_ALT_VER_SEL not set');
	}

	if (usage === 'include' || usage === 'override') {
		// Include and Override path - the hidden Python interpreter directory
		return process.env.CI
			? '/root/scratch/python-env'
			: '/Users/runner/scratch/python-env'; // <-- modify for local testing
	} else {
		// Exclude path - the standard pyenv location for the version
		return process.env.CI
			? `~/.pyenv`
			: `/Users/runner/.pyenv/versions/${version}`; // <-- modify for local testing
	}
}

/**
 * Helper function to verify that starting a session fails (e.g., when interpreter is excluded).
 * If the session starts successfully, the test will fail.
 */
export async function expectSessionStartToFail(
	sessions: Sessions,
	interpreterName: SessionRuntimes,
	excludedPath: string
): Promise<void> {
	let sessionStarted = false;
	try {
		await sessions.start(interpreterName, { reuse: false });
		sessionStarted = true;
	} catch (e) {
		// Expected - session should fail to start
	}

	if (sessionStarted) {
		fail(`Expected interpreter to be excluded: ${excludedPath}`);
	}
}
