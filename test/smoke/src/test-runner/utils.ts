/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
const rimraf = require('rimraf');

const TEST_REPO = process.env.TEST_REPO;
const WORKSPACE_PATH = process.env.WORKSPACE_PATH || 'WORKSPACE_PATH is not set';

/**
 * Clones or copies the test repository based on options.
 */
export function cloneTestRepo() {
	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';

	if (TEST_REPO) {
		console.log('Copying test project repository from:', TEST_REPO);
		// Remove the existing workspace path if the option is provided
		rimraf.sync(WORKSPACE_PATH);

		// Copy the repository based on the platform (Windows vs. non-Windows)
		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${TEST_REPO}" "${WORKSPACE_PATH}\\*"`);
		} else {
			cp.execSync(`cp -R "${TEST_REPO}" "${WORKSPACE_PATH}"`);
		}
	} else {
		// If no test-repo is specified, clone the repository if it doesn't exist
		if (!fs.existsSync(WORKSPACE_PATH)) {
			console.log('Cloning test project repository from:', testRepoUrl);
			const res = cp.spawnSync('git', ['clone', testRepoUrl, WORKSPACE_PATH], { stdio: 'inherit' });

			// Check if cloning failed by verifying if the workspacePath was created
			if (!fs.existsSync(WORKSPACE_PATH)) {
				throw new Error(`Clone operation failed: ${res.stderr?.toString()}`);
			}
		} else {
			console.log('Cleaning and updating test project repository...');
			// Fetch the latest changes, reset to the latest commit, and clean the repo
			cp.spawnSync('git', ['fetch'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
			cp.spawnSync('git', ['clean', '-xdf'], { cwd: WORKSPACE_PATH, stdio: 'inherit' });
		}
	}
}
