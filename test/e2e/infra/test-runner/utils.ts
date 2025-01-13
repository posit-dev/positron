/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import rimraf from 'rimraf';
import * as os from 'os';

export function cloneTestRepo(workspacePath = process.env.WORKSPACE_PATH || 'WORKSPACE_PATH is not set cloneRepo') {
	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';
	const cacheDir = path.join(os.tmpdir(), 'qa-example-content-cache');
	const cachedCommitFile = path.join(cacheDir, '.cached-commit');
	const branch = 'main';

	if (process.env.FORCE_CLONE === 'true') {
		console.log('FORCE_CLONE is set.');
		rimraf.sync(cacheDir);
	}

	try {
		console.log(`Preparing workspace at: ${workspacePath}`);

		// Get the latest commit hash from the remote repo
		const remoteCommitHash = cp.execSync(`git ls-remote ${testRepoUrl} refs/heads/${branch}`).toString().split('\t')[0].trim();

		// Check if cache exists and matches the latest commit hash
		if (fs.existsSync(cacheDir) && fs.existsSync(cachedCommitFile)) {
			const cachedCommitHash = fs.readFileSync(cachedCommitFile, 'utf-8').trim();
			if (remoteCommitHash === cachedCommitHash) {
				rimraf.sync(workspacePath);
				fs.mkdirSync(workspacePath, { recursive: true });
				copyDirectory(cacheDir, workspacePath);
				console.log('Workspace updated from cache.');
				return;
			}
		}

		// If cache is missing or outdated, download a fresh copy
		console.log('Cache outdated or missing. Cloning fresh repo.');
		rimraf.sync(cacheDir);
		cp.spawnSync('git', ['clone', '--depth=1', '--branch', branch, testRepoUrl, cacheDir], { stdio: 'inherit' });

		// Store the latest commit hash in the cache
		fs.writeFileSync(cachedCommitFile, remoteCommitHash);

		// Copy fresh repo to the workspace
		rimraf.sync(workspacePath);
		fs.mkdirSync(workspacePath, { recursive: true });
		copyDirectory(cacheDir, workspacePath);
	} catch (error) {
		console.error(`Error while cloning/updating repository: ${(error as Error).message}`);
		throw error;
	}
}

function copyDirectory(source: string, destination: string): void {
	if (process.platform === 'win32') {
		cp.execSync(`xcopy /E /I /Y "${source}" "${destination}\\*"`, { stdio: 'inherit' });
	} else {
		cp.execSync(`cp -R "${source}" "${destination}"`, { stdio: 'inherit' });
	}
}
