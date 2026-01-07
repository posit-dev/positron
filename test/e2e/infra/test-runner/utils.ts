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
	const branch = 'main';

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
		cp.execSync(`xcopy /E /H /K /Y "${source}\\*" "${destination}\\"`);
	} else {
		cp.execSync(`cp -R "${source}/." "${destination}"`);
	}
	console.log(`✓ Workspace: ${destination}`);
}

/**
 * Copies a fixture file to a specified destination folder.
 * If `replaceCtrl` is true, it replaces 'cmd' with 'ctrl' in the file content for compatibility with non-macOS platforms.
 *
 * @param fixtureFilename - The name of the fixture file to copy.
 * @param destinationFolder - The folder where the fixture file should be copied.
 * @param replaceCtrl - Whether to replace 'cmd' with 'ctrl' in the file content (default: false).
 */
export async function copyFixtureFile(fixtureFilename: string, destinationFolder: string, replaceCtrl = false): Promise<void> {
	const fixturesDir = path.join(process.cwd(), 'test/e2e/fixtures');
	const fixturesFilePath = path.join(fixturesDir, fixtureFilename);
	const fileName = path.basename(fixturesFilePath);
	const destinationFilePath = path.join(destinationFolder, fileName);

	try {
		// Create destination directory if it doesn't exist yet
		const destDir = path.dirname(destinationFilePath);
		await fs.promises.mkdir(destDir, { recursive: true });

		if (replaceCtrl && (process.platform === 'win32' || process.platform === 'linux')) {
			// For files needing text replacement
			const data = await fs.promises.readFile(fixturesFilePath, 'utf8');
			const modifiedData = data.replace(/cmd/gi, 'ctrl');
			await fs.promises.writeFile(destinationFilePath, modifiedData, 'utf8');
		} else {
			// Direct file copy when no replacement needed
			await fs.promises.copyFile(fixturesFilePath, destinationFilePath);
		}
	} catch (err) {
		console.error(`✗ Failed to copy fixture file ${fixtureFilename}:`, err);
		throw err;
	}
}

