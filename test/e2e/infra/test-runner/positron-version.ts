/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Split out of test-setup.ts so callers that want only the version do not pull in
 * the harness: test-setup imports the infra barrel, which reaches electron.ts and
 * its `ncp` dependency. `ncp` is declared in test/e2e/package.json and absent from
 * the root lockfile, so that chain fails to resolve in the root vitest lane.
 *
 * Deliberately in the same directory as test-setup.ts: getVersionFromScript walks
 * __dirname up four levels to the repo root, and moving the file would silently
 * change where that lands.
 */

export type PositronVersion = { positronVersion: string; buildNumber: number };

export function getPositronVersion(testCodePath = process.env.BUILD || ''): PositronVersion | null {
	// Dev mode - use version script directly
	if (!testCodePath) {
		return getVersionFromScript();
	}

	// Running against a build - read from built app's product.json
	return getVersionFromBuild(testCodePath);
}

/**
 * Get version info from the version script (dev mode)
 */
function getVersionFromScript(): PositronVersion | null {
	const root = join(__dirname, '..', '..', '..', '..');
	const scriptPath = join(root, 'versions', 'show-version.cjs');

	try {
		const positronVersion = execSync(`node "${scriptPath}" --version`).toString().trim();
		const buildOutput = execSync(`node "${scriptPath}" --build`).toString().trim();
		const buildNumber = parseInt(buildOutput, 10);

		if (!positronVersion) {
			console.warn('Version script returned empty version');
			return null;
		}

		return {
			positronVersion,
			buildNumber: Number.isNaN(buildNumber) ? 0 : buildNumber
		};
	} catch (e) {
		console.warn('Failed to get version from script:', e);
		return null;
	}
}

/**
 * Get version info from a built application's product.json
 */
function getVersionFromBuild(testCodePath: string): PositronVersion | null {
	let productJsonPath;

	switch (process.platform) {
		case 'darwin':
			productJsonPath = join(testCodePath, 'Contents', 'Resources', 'app', 'product.json');
			break;
		case 'linux':
			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
			break;
		case 'win32':
			productJsonPath = join(testCodePath, 'resources', 'app', 'product.json');
			break;
		default:
			return null;
	}

	try {
		const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
		const positronVersion = productJson.positronVersion ?? null;
		const buildNumber = productJson.positronBuildNumber ?? 0;

		if (!positronVersion) {
			throw new Error('positronVersion not found in product.json.');
		}

		return { positronVersion, buildNumber };
	} catch (error) {
		console.error('Error reading product.json:', error);
		return null;
	}
}
