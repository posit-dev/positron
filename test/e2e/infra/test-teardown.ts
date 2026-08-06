/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { execSync } from 'child_process';

export class TestTeardown {

	constructor(private _workspacePathOrFolder: string) { }

	async removeTestFiles(files: string[]): Promise<void> {
		for (const file of files) {
			try {
				const filePath = this._workspacePathOrFolder + '/' + file;
				if (fs.existsSync(filePath)) {
					fs.rmSync(filePath, { recursive: true, force: true });
				}
			} catch (error) {
				// Don't let cleanup errors fail the test run
				console.warn(`Failed to remove test file "${file}":`, error);
			}
		}
	}

	async removeTestFolder(folder: string): Promise<void> {
		const folderPath = this._workspacePathOrFolder + '/' + folder;
		if (fs.existsSync(folderPath)) {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	}

	/**
	 * Reverts tracked files to their baseline. All workers share one workspace,
	 * so this runs while other specs are mid-test: `git reset --hard` is safe
	 * there, but `git clean -fd` would delete their runtime fixtures. Opt into
	 * `removeUntracked` only when the filenames are unknowable (an LLM chose
	 * them); otherwise use `removeTestFiles` / `removeTestFolder`.
	 */
	async discardAllChanges(options: { removeUntracked?: boolean } = {}): Promise<void> {
		try {
			// Get the root commit hash
			const rootCommitHash = execSync('git rev-list --max-parents=0 HEAD', { cwd: this._workspacePathOrFolder }).toString().trim();
			// Reset to the root commit
			execSync(`git reset --hard ${rootCommitHash}`, { cwd: this._workspacePathOrFolder });
			if (options.removeUntracked) {
				execSync('git clean -fd', { cwd: this._workspacePathOrFolder });
			}
		} catch (error) {
			console.error('Failed to discard changes:', error);
		}
	}
}
