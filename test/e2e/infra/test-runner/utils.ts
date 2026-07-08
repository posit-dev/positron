/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Provisions the e2e test workspace by copying the local `test/e2e/test-files`
 * directory (merged in from the former qa-example-content repo) into the given
 * workspace path, then initializing it as a git repo with a single baseline
 * commit.
 *
 * The git baseline is required by test teardown: `TestTeardown.discardAllChanges`
 * runs `git rev-list --max-parents=0 HEAD` + `git reset --hard` + `git clean -fd`
 * to restore the workspace between tests, and some tests (e.g. scm) expect the
 * opened folder to be a git working tree.
 */
export function provisionTestFiles(workspacePath = process.env.WORKSPACE_PATH || 'WORKSPACE_PATH is not set in provisionTestFiles'): void {
	// Prevent Git warnings about missing templates.
	process.env.GIT_TEMPLATE_DIR = '';

	const source = path.join(process.cwd(), 'test/e2e/test-files');
	if (!fs.existsSync(source)) {
		console.error(`✗ Test files not found at ${source}`);
		return;
	}

	// Clear any stale copy first: git pack files are read-only, so cp -R
	// (and xcopy) cannot overwrite them on a rerun, causing "Permission denied".
	fs.rmSync(workspacePath, { recursive: true, force: true });
	fs.mkdirSync(workspacePath, { recursive: true });
	if (process.platform === 'win32') {
		cp.execSync(`xcopy /E /H /K /Y "${source}\\*" "${workspacePath}\\"`);
	} else {
		cp.execSync(`cp -R "${source}/." "${workspacePath}"`);
	}

	// Initialize a git baseline so teardown can reset the workspace between tests.
	// Inline identity + disabled signing so CI hosts without global git config succeed.
	try {
		const git = (args: string) => cp.execSync(`git ${args}`, { cwd: workspacePath, stdio: 'pipe' });
		git('init -q');
		git('add -A');
		git('-c user.email=e2e@posit.co -c user.name=e2e -c commit.gpgsign=false commit -q -m "test-files baseline"');
	} catch (error) {
		console.error('✗ Failed to initialize test-files git baseline:', error);
		return;
	}

	console.log(`✓ Workspace: ${workspacePath}`);
}

/**
 * Recursively copies a fixture folder to a destination, creating the destination
 * if it doesn't exist. Unlike `copyFixtureFile`, the source is a caller-supplied
 * absolute path, so the fixture can live anywhere in the repo (not just under
 * `test/e2e/fixtures/`).
 *
 * @param source - Absolute path to the folder to copy.
 * @param destination - Absolute path the folder's contents should be copied into.
 */
export function copyFixtureFolder(source: string, destination: string): void {
	fs.mkdirSync(destination, { recursive: true });
	if (process.platform === 'win32') {
		cp.execSync(`xcopy /E /H /K /Y "${source}\\*" "${destination}\\"`);
	} else {
		cp.execSync(`cp -R "${source}/." "${destination}"`);
	}
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

