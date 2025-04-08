/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import rimraf from 'rimraf';
import * as os from 'os';

export function cloneTestRepo(workspacePath = process.env.WORKSPACE_PATH || 'WORKSPACE_PATH is not set in cloneTestRepo'): void {
	// Prevent Git warnings about missing templates.
	process.env.GIT_TEMPLATE_DIR = '';

	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';
	const cacheDir = path.join(os.tmpdir(), 'qa-example-content-cache');
	const cachedCommitFile = path.join(cacheDir, '.cached-commit');
	const branch = 'mi/enable-multisessions-ff';

	// Check if the machine is online by attempting to fetch the latest commit hash.
	let remoteCommitHash: string | null = null;
	try {
		remoteCommitHash = cp.execSync(`git ls-remote ${testRepoUrl} refs/heads/${branch}`, { stdio: 'pipe' })
			.toString()
			.split('\t')[0]
			.trim();
	} catch {
		console.warn('! Warning: No internet connection detected');
	}

	// Prevent force cloning if offline
	if (process.env.FORCE_CLONE === 'true') {
		if (!remoteCommitHash) {
			console.error('✗ FORCE_CLONE is set, but the machine is offline. Skipping repository clone');
		} else {
			console.log('i FORCE_CLONE is set, forcing a fresh clone');
			rimraf.sync(cacheDir);
		}
	}

	// Check if cache exists and is valid
	const hasCachedRepo = fs.existsSync(cacheDir) && fs.existsSync(cachedCommitFile);
	const cachedCommitHash = hasCachedRepo ? fs.readFileSync(cachedCommitFile, 'utf-8').trim() : null;

	// Use cache if available and up-to-date OR if offline
	if (hasCachedRepo && (remoteCommitHash === cachedCommitHash || !remoteCommitHash)) {
		console.log('✓ Using cached repository');
		copyRepo(cacheDir, workspacePath);
		return;
	}

	if (!remoteCommitHash) {
		console.error('✗ No internet connection and no valid cache found');
		return;
	}

	// Clone fresh repo
	console.log('✓ Cloning fresh repository...');
	rimraf.sync(cacheDir);
	if (cp.spawnSync('git', ['clone', '--depth=1', '--branch', branch, testRepoUrl, cacheDir, '-q'], { stdio: 'inherit' }).status !== 0) {
		console.error('✗ Failed to clone repository');
		return;
	}

	fs.writeFileSync(cachedCommitFile, remoteCommitHash);
	copyRepo(cacheDir, workspacePath);
}

function copyRepo(source: string, destination: string): void {
	if (process.platform === 'win32') {
		cp.execSync(`xcopy /E /H /K /Y "${source}\\*" "${destination}\\*"`);
	} else {
		cp.execSync(`cp -R "${source}/." "${destination}"`);
	}
	console.log(`✓ Workspace: ${destination}`);
}
