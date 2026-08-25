/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Split out of test-setup.ts so unit tests can read the version without pulling in
 * the harness: test-setup imports the infra barrel, which reaches electron.ts and
 * its `ncp` dependency, which is absent from the root lockfile.
 *
 * Kept in this directory because getVersionFromScript walks __dirname up four
 * levels to the repo root; moving the file would silently change where that lands.
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

	// A positron-server build keeps product.json at its root rather than under
	// resources/app, so the platform paths above miss it. Falling back rather than
	// branching on a lane keeps this helper free of the memory harness's concepts:
	// the question is only where this build put its product.json.
	if (!fs.existsSync(productJsonPath)) {
		const serverProductJsonPath = join(testCodePath, 'product.json');
		if (fs.existsSync(serverProductJsonPath)) {
			productJsonPath = serverProductJsonPath;
		}
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
