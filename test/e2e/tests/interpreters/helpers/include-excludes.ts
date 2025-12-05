/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { SessionRuntimes, Sessions } from '../../../pages/sessions.js';

/**
 * Helper function to build R path based on environment.
 * Reads version from POSITRON_R_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'exclude' or 'override'
 */
export function buildRPath(usage: 'exclude' | 'override' = 'exclude'): string {
	const version = process.env.POSITRON_R_ALT_VER_SEL || 'alternate R not set';
	const majorMinor = version.split('.').slice(0, 2).join('.');
	if (process.env.CI) {
		// Linux: excludes use directory path, overrides use full binary path
		return usage === 'exclude' ? `/opt/R/${version}` : `/opt/R/${version}/bin/R`;
	} else {
		// macOS: excludes include /Resources, overrides don't
		const resourcesPath = usage === 'exclude' ? '/Resources' : '';
		return `/Library/Frameworks/R.framework/Versions/${majorMinor}-arm64${resourcesPath}/bin/R`;
	}
}

/**
 * Helper function to build Python path based on environment.
 * Reads version from POSITRON_PY_ALT_VER_SEL environment variable.
 * @param usage - Whether to build path for 'exclude' or 'override'
 */
export function buildPythonPath(usage: 'exclude' | 'override' = 'exclude'): string {
	const version = process.env.POSITRON_PY_ALT_VER_SEL || 'alternate Python not set';
	if (usage === 'exclude') {
		return process.env.CI
			? `~/.pyenv`
			: `/Users/runner/.pyenv/versions/${version}`;
	} else {
		// Override path - the hidden Python interpreter location
		return process.env.CI
			? '/root/scratch/python-env'
			: '/Users/runner/scratch/python-env';
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
