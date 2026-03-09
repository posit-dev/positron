/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as fs from 'fs';
import * as path from 'path';

import { ParticipantService } from './participants.js';
import { API as GitAPI, GitExtension, Repository, Status, Change } from '../../git/src/api/git.js';
import { MARKDOWN_DIR } from './constants';
import { PROVIDER_METADATA } from './providerMetadata.js';

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
export async function generateCommitMessage(
	context: vscode.ExtensionContext,
	participantService: ParticipantService,
	log: vscode.LogOutputChannel,
) {
	await vscode.commands.executeCommand('setContext', generatingGitCommitKey, true);

	const candidates = await getCandidateModels(participantService);
	log.info(`[git] Found ${candidates.length} candidate model(s) for commit message generation.`);
	log.debug(`[git] Candidate models: ${candidates.map(m => `(${m.vendor}) ${m.id}`).join(', ')}`);

	const tokenSource: vscode.CancellationTokenSource = new vscode.CancellationTokenSource();
	const cancelDisposable = vscode.commands.registerCommand('positron-assistant.cancelGenerateCommitMessage', () => {
		tokenSource.cancel();
		vscode.commands.executeCommand('setContext', generatingGitCommitKey, false);
	});

	// Send repo changes to the LLM and update the commit message input boxes
	const allChanges = await getWorkspaceGitChanges(GitRepoChangeKind.All);
	const stagedChanges = await getWorkspaceGitChanges(GitRepoChangeKind.Staged);
	const gitChanges = stagedChanges.length > 0 ? stagedChanges : allChanges;
	log.trace(`[git] Sending changes ${JSON.stringify(gitChanges)} to model provider.`);

	const system: string = await fs.promises.readFile(path.join(MARKDOWN_DIR, 'prompts', 'git', 'commit.md'), 'utf8');
	try {
		await Promise.all(gitChanges.map(async ({ repo, changes }) => {
			if (changes.length > 0) {
				const repoLabel = path.basename(repo.rootUri.fsPath);
				const messages = [
					new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.System, system),
					vscode.LanguageModelChatMessage.User(changes.map(change => change.summary).join('\n')),
				];

				for (const model of candidates) {
					try {
						log.info(`[git] [${repoLabel}] Trying model (${model.vendor}) ${model.id} for commit message generation.`);
						const response = await model.sendRequest(messages, {}, tokenSource.token);

						repo.inputBox.value = '';
						for await (const delta of response.text) {
							if (tokenSource.token.isCancellationRequested) {
								return null;
							}
							repo.inputBox.value += delta;
						}
						return; // Success - stop trying other models
					} catch (e) {
						if (e instanceof vscode.CancellationError) {
							throw e;
						}
						const error = e as Error;
						repo.inputBox.value = '';
						log.warn(`[git] [${repoLabel}] Model (${model.vendor}) ${model.id} failed: ${error.message}. Trying next candidate.`);
					}
				}

				// All candidates failed
				throw new Error('All candidate models failed for commit message generation. Check the log for details.');
			}
		}));
	} catch (e) {
		const error = e as Error;
		log.error(`[git] Error generating commit message: ${error.message}`);
		void vscode.window.showErrorMessage(`Error generating commit message: ${error.message}`);
		throw e;
	} finally {
		cancelDisposable.dispose();
		vscode.commands.executeCommand('setContext', generatingGitCommitKey, false);
	}
}

export async function getCandidateModels(participantService: ParticipantService): Promise<vscode.LanguageModelChat[]> {
	const candidates: vscode.LanguageModelChat[] = [];
	const seen = new Set<string>();
	const addCandidate = (model: vscode.LanguageModelChat) => {
		if (!seen.has(model.id)) {
			seen.add(model.id);
			candidates.push(model);
		}
	};

	// First priority: the latest chat session model.
	const sessionModelId = participantService.getCurrentSessionModel();
	if (sessionModelId) {
		const models = await vscode.lm.selectChatModels({ 'id': sessionModelId });
		if (models && models.length > 0) {
			addCandidate(models[0]);
		}
	}

	// Second priority: models for the currently selected provider.
	const currentProvider = await positron.ai.getCurrentProvider();
	if (currentProvider) {
		const models = await vscode.lm.selectChatModels({ vendor: currentProvider.id });
		for (const model of models) {
			addCandidate(model);
		}
	}

	// Third priority: all available models from any provider.
	const models = await vscode.lm.selectChatModels();
	for (const model of models) {
		if (model.family !== PROVIDER_METADATA.echo.id && model.family !== PROVIDER_METADATA.error.id) {
			addCandidate(model);
		}
	}

	if (candidates.length === 0) {
		throw new Error('No language models available for git commit message generation');
	}

	return candidates;
}
