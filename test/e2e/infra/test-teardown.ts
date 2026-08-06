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
	 * Restores the given tracked files to the provisioned baseline commit.
	 *
	 * All workers share one workspace, so teardown runs while other specs are
	 * mid-test. Pass only the files this spec edited: a repo-wide reset would
	 * revert files another spec is actively using.
	 */
	async restoreFiles(files: string[]): Promise<void> {
		if (files.length === 0) {
			return;
		}
		try {
			const baseline = this._git('rev-list --max-parents=0 HEAD').trim();
			// Callers build paths with path.join, but git pathspecs want forward slashes.
			const pathspec = files.map(file => `"${file.replace(/\\/g, '/')}"`).join(' ');
			// --staged as well as --worktree, so a spec that staged a change (scm) leaves nothing behind.
			this._git(`restore --source=${baseline} --staged --worktree -- ${pathspec}`);
			// A spec that commits (scm) leaves the branch ahead of the baseline; rewind it
			// without touching any file, so the restore above is what git status reports.
			this._git(`reset --soft ${baseline}`);
		} catch (error) {
			// Don't let cleanup errors fail the test run
			console.warn('Failed to restore test files:', error);
		}
	}

	/**
	 * Workspace-relative paths that differ from the baseline commit. Pair it with
	 * `revertChangesSince` when a spec cannot name the files it produces (an LLM
	 * chose them); otherwise prefer `restoreFiles` / `removeTestFiles`.
	 */
	dirtyFiles(): Set<string> {
		return new Set(this._dirtyFiles().keys());
	}

	/**
	 * Reverts only what became dirty after the snapshot: new untracked files are
	 * deleted, modified tracked files restored. Files another worker was already
	 * changing are in the snapshot, so they are left alone.
	 */
	async revertChangesSince(snapshot: Set<string>): Promise<void> {
		const toRemove: string[] = [];
		const toRestore: string[] = [];

		try {
			for (const [file, status] of this._dirtyFiles()) {
				if (snapshot.has(file)) {
					continue;
				}
				(status === '??' ? toRemove : toRestore).push(file);
			}
		} catch (error) {
			console.warn('Failed to list workspace changes:', error);
			return;
		}

		await this.removeTestFiles(toRemove);
		await this.restoreFiles(toRestore);
	}

	/** Workspace-relative path -> two-letter git status code. */
	private _dirtyFiles(): Map<string, string> {
		// -z avoids git's path quoting; --no-renames keeps every record a plain "XY path".
		const status = this._git('status --porcelain -z --untracked-files=all --no-renames');
		return new Map(
			status.split('\0').filter(Boolean).map(record => [record.slice(3), record.slice(0, 2)])
		);
	}

	private _git(args: string): string {
		return execSync(`git ${args}`, { cwd: this._workspacePathOrFolder }).toString();
	}
}
