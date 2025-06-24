/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { GitExtension, Repository, Status, Change } from '../../git/src/api/git.js';

export enum GitRepoChangeKind {
	Staged = 'staged',
	Unstaged = 'unstaged',
	Merge = 'merge',
	Untracked = 'untracked',
	All = 'all',
}

export interface GitRepoChangeSummary {
	uri: vscode.Uri;
	summary: string;
}

export interface GitRepoChange {
	repo: Repository;
	changes: GitRepoChangeSummary[];
}

/** Get the list of active repositories */
function currentGitRepositories(): Repository[] {
	// Obtain a handle to git extension API
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
	if (!gitExtension) {
		throw new Error('Git extension not found');
	}
	const git = gitExtension.getAPI(1);
	if (git.repositories.length === 0) {
		throw new Error('No Git repositories found');
	}

	return git.repositories;
}

/** Summarise the content of a git change */
async function gitChangeSummary(repo: Repository, change: Change, kind: GitRepoChangeKind): Promise<GitRepoChangeSummary> {
	const uri = change.uri.fsPath.replace(repo.rootUri.fsPath, '');
	const originalUri = change.originalUri.fsPath.replace(repo.rootUri.fsPath, '');
	const renameUri = change.renameUri?.fsPath.replace(repo.rootUri.fsPath, '');
	switch (change.status) {
		// File-level changes
		case Status.INDEX_ADDED:
		case Status.UNTRACKED:
			return { uri: change.uri, summary: `Added: ${uri}` };
		case Status.INDEX_DELETED:
		case Status.DELETED:
			return { uri: change.uri, summary: `Deleted: ${uri}` };
		case Status.INDEX_RENAMED:
			return { uri: change.uri, summary: `Renamed: ${originalUri} to ${renameUri}` };
		case Status.INDEX_COPIED:
			return { uri: change.uri, summary: `Copied: ${originalUri} to ${uri}` };
		case Status.IGNORED:
			return { uri: change.uri, summary: `Ignored: ${uri}` };
		default: {
			// Otherwise, git diff text content for this file
			if (kind === GitRepoChangeKind.Staged) {
				const diff = await repo.diffIndexWithHEAD(change.uri.fsPath);
				return { uri: change.uri, summary: `Modified:\n${diff}` };
			} else {
				const diff = await repo.diffWithHEAD(change.uri.fsPath);
				return { uri: change.uri, summary: `Modified:\n${diff}` };
			}
		}
	}
}

/** Get current workspace git repository changes as text summaries */
export async function getWorkspaceGitChanges(kind: GitRepoChangeKind): Promise<GitRepoChange[]> {
	const repos = currentGitRepositories();

	// Combine and summarise each kind of git repo change
	return Promise.all(repos.map(async (repo) => {
		const stateChanges: { change: Change; kind: GitRepoChangeKind }[] = [];

		if (kind === GitRepoChangeKind.Staged || kind === GitRepoChangeKind.All) {
			stateChanges.push(...repo.state.indexChanges.map((change) => {
				return { change, kind: GitRepoChangeKind.Staged };
			}));
		}
		if (kind === GitRepoChangeKind.Unstaged || kind === GitRepoChangeKind.All) {
			stateChanges.push(...repo.state.workingTreeChanges.map((change) => {
				return { change, kind: GitRepoChangeKind.Unstaged };
			}));
		}
		if (kind === GitRepoChangeKind.Untracked || kind === GitRepoChangeKind.All) {
			stateChanges.push(...repo.state.untrackedChanges.map((change) => {
				return { change, kind: GitRepoChangeKind.Untracked };
			}));
		}
		if (kind === GitRepoChangeKind.Merge || kind === GitRepoChangeKind.All) {
			stateChanges.push(...repo.state.mergeChanges.map((change) => {
				return { change, kind: GitRepoChangeKind.Merge };
			}));
		}

		const changes = await Promise.all(stateChanges.map(async (state) => {
			return gitChangeSummary(repo, state.change, state.kind);
		}));
		return { repo, changes };
	}));
}
