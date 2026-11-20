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

/** How long the host waits after the last change it sees before it tells the engine (spec 5.1). */
const CHANGE_DELAY_MS = 500;

/** The engine as `positron.checkpoints.registerEngine` takes it. */
type RegisteredEngine = Parameters<typeof positron.checkpoints.registerEngine>[0];

/** The engine of the moment, with its registration and its change listener. */
interface Current { engine: Engine; registration: vscode.Disposable; listener: { dispose(): void } }

/**
 * Creates the checkpoints engine for one workspace folder and registers it with Positron (spec
 * 5.1). The engine runs git with the git extension's program, and fetches and pushes through the
 * git extension's `Repository`, so its sign-in is used. Changes to the folder's files and to the
 * repository's state reach the engine as `notifyChanged`, `CHANGE_DELAY_MS` after the last one.
 *
 * In a folder that is not a repository yet, the engine is created again (and registered again)
 * once a repository exists there: after `startTracking` succeeds, or when the git extension opens
 * one. The new engine's file port then knows the repository's git directory.
 *
 * Every disposable is added to `context.subscriptions`.
 */
export class EngineHost {
	private readonly onDidChangeStateEmitter = new vscode.EventEmitter<void>();
	private readonly watchedRepositories = new Set<Repository>();
	private current: Current | undefined;
	/** The project root the current engine's ports use. */
	private root: string;
	/** Whether the current engine was created for a repository. */
	private inRepository = false;
	private changeTimer: ReturnType<typeof setTimeout> | undefined;
	/** The latest engine creation; creations run one after another. */
	private creating: Promise<void> = Promise.resolve();

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
		);
		await this.recreate();
	}

	/**
	 * Creates the engine, after any creation still running. Does nothing when the engine of that
	 * moment was already created for a repository.
	 */
	private recreate(): Promise<void> {
		this.creating = this.creating.then(() => this.current !== undefined && this.inRepository ? undefined : this.createAndRegister()).catch(error => {
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
			this.watchRepository(repository);
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
		this.current = { engine, registration: positron.checkpoints.registerEngine(registered), listener };
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
	private repository(): Repository | undefined {
		return this.api.repositories.find(repository => path.relative(repository.rootUri.fsPath, this.root) === '');
	}

	private repositoryOpened(repository: Repository): void {
		this.watchRepository(repository);
		if (!this.inRepository) {
			void this.recreate();
		}
	}

	/** Tells the engine about changes to the state of `repository`, when it is the project's repository. */
	private watchRepository(repository: Repository): void {
		if (this.watchedRepositories.has(repository) || this.repository() !== repository) {
			return;
		}
		this.watchedRepositories.add(repository);
		this.context.subscriptions.push(repository.state.onDidChange(() => this.scheduleChange()));
	}

	private fileChanged(uri: vscode.Uri): void {
		const relative = path.relative(this.folder.uri.fsPath, uri.fsPath);
		if (!relative.split(/[\\/]/).includes('.git')) {
			this.scheduleChange();
		}
	}

	private scheduleChange(): void {
		clearTimeout(this.changeTimer);
		this.changeTimer = setTimeout(() => this.current?.engine.notifyChanged(), CHANGE_DELAY_MS);
	}

	/** Fetches and pushes through the git extension's repository for the project root. */
	private networkPort(): NetworkPort {
		const run = async (action: (repository: Repository) => Promise<void>): Promise<NetworkResult> => {
			const repository = this.repository();
			if (repository === undefined) {
				return { ok: false, reason: 'unknown', detail: 'no-repository' };
			}
			try {
				await action(repository);
				return { ok: true };
			} catch (error) {
				return mapGitError(error);
			}
		};
		return {
			fetch: () => run(repository => repository.fetch()),
			push: branch => run(repository => repository.push(repository.state.HEAD?.upstream?.remote ?? 'origin', branch)),
			publish: (remoteUrl, branch) => run(async repository => {
				// `connectSharedCopy` adds the remote before it publishes; another caller may not have.
				const existing = await repository.getConfig('remote.origin.url').catch(() => '');
				if (existing.trim() === '') {
					await repository.addRemote('origin', remoteUrl);
				}
				await repository.push('origin', branch, true);
			}),
		};
	}
}
