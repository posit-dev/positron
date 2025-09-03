/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { API as GitAPI, GitExtension, Repository, Status, Change } from '../../git/src/api/git.js';
import { MD_DIR } from './constants';

const generatingGitCommitKey = 'positron-assistant.generatingCommitMessage';

export enum GitRepoChangeKind {
	Staged = 'staged',
	Unstaged = 'unstaged',
	Merge = 'merge',
	Untracked = 'untracked',
	Commit = 'commit',
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

function getAPI(): GitAPI {
	// Obtain a handle to git extension API
	const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')?.exports;
	if (!gitExtension) {
		throw new Error('Git extension not found');
	}
	return gitExtension.getAPI(1);
}

/** Get the list of active repositories */
function currentGitRepositories(): Repository[] {
	const git = getAPI();
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

/** Get changes for a specific git repository and hash as text summaries */
export async function getCommitChanges(repoUri: vscode.Uri, hash: string, parentHash: string) {
	const git = getAPI();
	const repo = git.getRepository(repoUri);
	if (!repo) {
		throw new Error('Repository not found');
	}
	const repoPath = repoUri.fsPath + path.sep + '.';
	return repo.diffBetween(parentHash, hash, repoPath);
}

/** Get current workspace git repository changes as text summaries */
export async function getWorkspaceGitChanges(kind: GitRepoChangeKind): Promise<GitRepoChange[]> {
	const repos = currentGitRepositories();

	// Combine and summarise each kind of git repo change
	const repoChanges = await Promise.all(repos.map(async (repo) => {
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

	return repoChanges.filter((repoChange) => repoChange.changes.length > 0);
}

/** Generate a commit message for git repositories with staged changes */
export async function generateCommitMessage(context: vscode.ExtensionContext) {
	await vscode.commands.executeCommand('setContext', generatingGitCommitKey, true);

	const models = (await vscode.lm.selectChatModels()).filter((model) => {
		return model.family !== 'echo' && model.family !== 'error';
	});
	if (models.length === 0) {
		vscode.commands.executeCommand('setContext', generatingGitCommitKey, false);
		throw new Error('No language models available for commit message generation.');
	}
	const model = models[0];

	const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
	const cancelDisposable = vscode.commands.registerCommand('positron-assistant.cancelGenerateCommitMessage', () => {
		tokenSource.cancel();
		vscode.commands.executeCommand('setContext', generatingGitCommitKey, false);
	});

	// Send repo changes to the LLM and update the commit message input boxes
	const allChanges = await getWorkspaceGitChanges(GitRepoChangeKind.All);
	const stagedChanges = await getWorkspaceGitChanges(GitRepoChangeKind.Staged);
	const gitChanges = stagedChanges.length > 0 ? stagedChanges : allChanges;

	const system: string = await fs.promises.readFile(`${MD_DIR}/prompts/git/commit.md`, 'utf8');
	try {
		await Promise.all(gitChanges.map(async ({ repo, changes }) => {
			if (changes.length > 0) {
				const response = await model.sendRequest([
					vscode.LanguageModelChatMessage.User(changes.map(change => change.summary).join('\n')),
				], { modelOptions: { system } }, tokenSource.token);

				repo.inputBox.value = '';
				for await (const delta of response.text) {
					if (tokenSource.token.isCancellationRequested) {
						return null;
					}
					repo.inputBox.value += delta;
				}
			}
		}));
	} finally {
		cancelDisposable.dispose();
		vscode.commands.executeCommand('setContext', generatingGitCommitKey, false);
	}
}
