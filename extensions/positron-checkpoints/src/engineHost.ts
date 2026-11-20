/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { createEngine, Engine } from './engine/engine';
import { createGitRunner } from './engine/git';
import { mapGitError } from './engine/networkErrors';
import { createNodeFilePort } from './engine/nodeFilePort';
import { EnginePorts, NetworkPort, NetworkResult } from './engine/ports';
import type { API, Repository } from './gitApi';
import { findRepository } from './repositoryMatch';

/** How long the host waits after the last change it sees before it tells the engine (spec 5.1). */
const CHANGE_DELAY_MS = 500;

/** The longest the host holds back changes while they keep coming. */
const CHANGE_MAX_WAIT_MS = 3000;

/** The engine as `positron.checkpoints.registerEngine` takes it. */
type RegisteredEngine = Parameters<typeof positron.checkpoints.registerEngine>[0];

/** The engine of the moment, with its registration and its change listener. */
interface Current { engine: Engine; registration: vscode.Disposable; listener: { dispose(): void } }

/**
 * Creates the checkpoints engine for one workspace folder and registers it with Positron (spec
 * 5.1). The engine runs git with the git extension's program, and fetches and pushes through the
 * git extension's `Repository`, so its sign-in is used. Changes to the folder's files and to the
 * repository's state reach the engine as `notifyChanged`, `CHANGE_DELAY_MS` after the last one,
 * and at most `CHANGE_MAX_WAIT_MS` after the first one while they keep coming.
 *
 * In a folder that is not a repository yet, the engine is created again (and registered again)
 * once a repository exists there: after `startTracking` succeeds, or when the git extension opens
 * one. The new engine's file port then knows the repository's git directory. The host waits until
 * the old engine is idle before it creates the new one, and of the requests that arrive while it
 * waits only the latest is carried out.
 *
 * Every disposable is added to `context.subscriptions`.
 */
export class EngineHost {
	private readonly onDidChangeStateEmitter = new vscode.EventEmitter<void>();
	/** The state listener of each repository the host watches, until the git extension closes it. */
	private readonly watchedRepositories = new Map<Repository, vscode.Disposable>();
	/** The repositories the git extension closed; the extension opens a new object for a repository it opens again. */
	private readonly closedRepositories = new WeakSet<Repository>();
	private current: Current | undefined;
	/** The project root the current engine's ports use. */
	private root: string;
	/** Whether the current engine was created for a repository. */
	private inRepository = false;
	private changeTimer: ReturnType<typeof setTimeout> | undefined;
	/** When the first change that the engine has not been told about arrived. */
	private changesSince: number | undefined;
	/** The latest engine creation; creations run one after another. */
	private creating: Promise<void> = Promise.resolve();
	/** The number of creation requests so far; a request that is not the latest is skipped. */
	private creationRequests = 0;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly folder: vscode.WorkspaceFolder,
		private readonly api: API,
		private readonly log: vscode.LogOutputChannel,
	) {
		this.root = folder.uri.fsPath;
		context.subscriptions.push(
			this.onDidChangeStateEmitter,
			{ dispose: () => this.disposeCurrent() },
			{ dispose: () => clearTimeout(this.changeTimer) },
			{
				dispose: () => {
					for (const listener of this.watchedRepositories.values()) {
						listener.dispose();
					}
					this.watchedRepositories.clear();
				},
			},
		);
	}

	/** Watches the folder and the repository, then creates and registers the first engine. */
	async start(): Promise<void> {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.folder, '**/*'));
		this.context.subscriptions.push(
			watcher,
			watcher.onDidCreate(uri => this.fileChanged(uri)),
			watcher.onDidChange(uri => this.fileChanged(uri)),
			watcher.onDidDelete(uri => this.fileChanged(uri)),
			this.api.onDidOpenRepository(repository => this.repositoryOpened(repository)),
			this.api.onDidCloseRepository(repository => this.repositoryClosed(repository)),
		);
		await this.recreate();
	}

	/**
	 * Creates the engine, after any creation still running and once the current engine is idle.
	 * Does nothing when the engine of that moment was already created for a repository, or when a
	 * later request arrived meanwhile (that request creates it).
	 */
	private recreate(): Promise<void> {
		const request = ++this.creationRequests;
		const isLatest = () => request === this.creationRequests;
		this.creating = this.creating.then(async () => {
			if (!isLatest() || (this.current !== undefined && this.inRepository)) {
				return;
			}
			// An engine replaced while it runs an operation (`git init` during `startTracking` opens
			// a repository) would leave that operation to a new engine's startup recovery.
			await this.current?.engine.idle();
			if (isLatest()) {
				await this.createAndRegister();
			}
		}).catch(error => {
			this.log.error(`The checkpoints engine could not start: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
		});
		return this.creating;
	}

	private async createAndRegister(): Promise<void> {
		const folderPath = this.folder.uri.fsPath;
		const gitPath = this.api.git.path;
		const git = createGitRunner(gitPath, folderPath);
		let extraRoots: string[] = [];
		let root = folderPath;
		const found = await git(['rev-parse', '--show-toplevel', '--absolute-git-dir']).catch(() => undefined);
		if (found !== undefined && found.exitCode === 0 && !found.timedOut) {
			// Git ends each path with a line terminator, and a path may itself end in a space.
			const [topLevel, gitDir] = found.stdout.split('\n').map(line => line.replace(/\r$/, ''));
			if (topLevel && gitDir) {
				root = topLevel;
				extraRoots = [gitDir];
			}
		}
		const ports: EnginePorts = {
			git,
			files: createNodeFilePort(root, extraRoots),
			network: this.networkPort(),
			now: () => new Date(),
			newId: () => randomUUID(),
			projectRoot: root,
			openedFolder: folderPath,
			log: message => this.log.error(message),
		};
		const engine = await createEngine(ports);

		this.disposeCurrent();
		this.root = root;
		this.inRepository = extraRoots.length > 0;
		for (const repository of this.api.repositories) {
			void this.watchRepository(repository);
		}
		const listener = engine.onDidChangeState(() => this.onDidChangeStateEmitter.fire());
		const registered: RegisteredEngine = {
			// The bridge calls only the methods of `CheckpointsEngine`.
			...engine,
			onDidChangeState: this.onDidChangeStateEmitter.event,
			startTracking: async (identity, gitignore) => {
				const result = await engine.startTracking(identity, gitignore);
				if (result.kind === 'done' && !this.inRepository) {
					void this.recreate();
				}
				return result;
			},
		};
		let registration: vscode.Disposable;
		try {
			registration = positron.checkpoints.registerEngine(registered);
		} catch (error) {
			listener.dispose();
			engine.dispose();
			this.log.error(`The checkpoints engine could not be registered: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
			return;
		}
		this.current = { engine, registration, listener };
		this.log.info(`Checkpoints engine registered for ${folderPath}`);
		this.onDidChangeStateEmitter.fire();
	}

	private disposeCurrent(): void {
		if (this.current !== undefined) {
			this.current.listener.dispose();
			this.current.registration.dispose();
			this.current.engine.dispose();
			this.current = undefined;
		}
	}

	/** The git extension's repository for the project root, when it has one open. */
	private repository(): Promise<Repository | undefined> {
		return findRepository(this.api.repositories, this.root);
	}

	private repositoryOpened(repository: Repository): void {
		void this.watchRepository(repository);
		if (!this.inRepository) {
			void this.recreate();
		}
	}

	private repositoryClosed(repository: Repository): void {
		this.closedRepositories.add(repository);
		this.watchedRepositories.get(repository)?.dispose();
		this.watchedRepositories.delete(repository);
	}

	/** Tells the engine about changes to the state of `repository`, when it is the project's repository. */
	private async watchRepository(repository: Repository): Promise<void> {
		if (this.watchedRepositories.has(repository) || await findRepository([repository], this.root) === undefined) {
			return;
		}
		// The repository may have been closed, or watched by another call, while the paths were resolved.
		if (this.watchedRepositories.has(repository) || this.closedRepositories.has(repository)) {
			return;
		}
		this.watchedRepositories.set(repository, repository.state.onDidChange(() => this.scheduleChange()));
	}

	private fileChanged(uri: vscode.Uri): void {
		const relative = path.relative(this.folder.uri.fsPath, uri.fsPath);
		if (!relative.split(/[\\/]/).includes('.git')) {
			this.scheduleChange();
		}
	}

	private scheduleChange(): void {
		clearTimeout(this.changeTimer);
		const now = Date.now();
		this.changesSince ??= now;
		const delay = Math.max(0, Math.min(CHANGE_DELAY_MS, this.changesSince + CHANGE_MAX_WAIT_MS - now));
		this.changeTimer = setTimeout(() => {
			this.changesSince = undefined;
			this.current?.engine.notifyChanged();
		}, delay);
	}

	/** Fetches and pushes through the git extension's repository for the project root. */
	private networkPort(): NetworkPort {
		const run = async (action: (repository: Repository) => Promise<NetworkResult | void>): Promise<NetworkResult> => {
			const repository = await this.repository();
			if (repository === undefined) {
				return { ok: false, reason: 'unknown', detail: 'no-repository' };
			}
			try {
				return await action(repository) ?? { ok: true };
			} catch (error) {
				return mapGitError(error);
			}
		};
		const config = (repository: Repository, key: string) => repository.getConfig(key).then(value => value.trim(), () => '');
		return {
			// Pruning removes the record of a branch the host deleted, such as an accepted proposal's,
			// so a sent proposal whose branch is gone counts as ended and is never sent again.
			fetch: () => run(repository => repository.fetch({ prune: true })),
			push: branch => run(async repository => {
				// The upstream can have another name than the local branch; the push goes to it.
				const remote = await config(repository, `branch.${branch}.remote`) || 'origin';
				const merge = await config(repository, `branch.${branch}.merge`);
				const target = merge.startsWith('refs/heads/') ? merge.slice('refs/heads/'.length) : branch;
				await repository.push(remote, `${branch}:${target}`);
			}),
			publish: (remoteUrl, branch) => run(async repository => {
				// `connectSharedCopy` adds the remote before it publishes; another caller may not have.
				const existing = await config(repository, 'remote.origin.url');
				if (existing === '') {
					await repository.addRemote('origin', remoteUrl);
				} else if (existing !== remoteUrl) {
					return { ok: false, reason: 'unknown', detail: 'origin-differs' };
				}
				await repository.push('origin', branch, true);
			}),
		};
	}
}
