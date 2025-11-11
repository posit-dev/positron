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
			const filePath = this._workspacePathOrFolder + '/' + file;
			if (fs.existsSync(filePath)) {
				fs.rmSync(filePath, { recursive: true, force: true });
			}
		}
	}

	async removeTestFolder(folder: string): Promise<void> {
		const folderPath = this._workspacePathOrFolder + '/' + folder;
		if (fs.existsSync(folderPath)) {
			fs.rmSync(folderPath, { recursive: true, force: true });
		}
	}

	async discardAllChanges(): Promise<void> {
		try {
			// Check if .git exists
			if (!fs.existsSync(`${this._workspacePathOrFolder}/.git`)) {
				// No git repo, skip git operations silently
				return;
			}

			// Check if this is a shallow clone
			const isShallow = fs.existsSync(`${this._workspacePathOrFolder}/.git/shallow`);

			if (isShallow) {
				// For shallow clones, just reset to HEAD and clean
				execSync('git reset --hard HEAD', { cwd: this._workspacePathOrFolder });
				execSync('git clean -fd', { cwd: this._workspacePathOrFolder });
			} else {
				// For full clones, reset to root commit
				const rootCommitHash = execSync('git rev-list --max-parents=0 HEAD', { cwd: this._workspacePathOrFolder }).toString().trim();
				execSync(`git reset --hard ${rootCommitHash}`, { cwd: this._workspacePathOrFolder });
				execSync('git clean -fd', { cwd: this._workspacePathOrFolder });
			}
		} catch (error) {
			console.error('Failed to discard changes:', error);
		}
	}
}
