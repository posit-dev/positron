/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGitRunner } from '../git';
import { createNodeFilePort } from '../nodeFilePort';
import { EnginePorts, GitRunner, NetworkPort, NetworkResult } from '../ports';

/** A clock that tests move by hand. */
export interface TestClock {
	set(time: Date): void;
	advance(milliseconds: number): void;
}

export interface TempRepo {
	root: string;
	git: GitRunner;
	ports: EnginePorts;
	clock: TestClock;
	write(file: string, text: string): Promise<void>;
	read(file: string): Promise<string>;
	/** Stages everything and commits it. Returns the new commit id. */
	commit(message: string): Promise<string>;
	/** Creates a second repository that shares this one's bare "origin". */
	clone(): Promise<TempRepo>;
	/** Pushes the other repository's `main` to the shared "origin". */
	pushFrom(other: TempRepo): Promise<void>;
	/**
	 * New ports for this repository that share nothing with `ports` except what is on disk and the
	 * clock, as a second engine instance (or a restart) would have. Their ids have their own prefix.
	 */
	freshPorts(): Promise<EnginePorts>;
	dispose(): Promise<void>;
}

// Keeps the machine's own git configuration out of every test repository.
const ISOLATED_ENV = {
	GIT_CONFIG_GLOBAL: os.platform() === 'win32' ? 'NUL' : '/dev/null',
	GIT_CONFIG_NOSYSTEM: '1',
};

// The host's identity variables would decide the outcome of identity tests.
for (const name of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'EMAIL']) {
	delete process.env[name];
}

const START_TIME = new Date('2026-01-01T00:00:00Z');

export interface TempRepoOptions {
	/**
	 * `'empty'` (default) runs `git init`, leaving a repository with no commits.
	 * `'none'` leaves a plain folder that is not a repository.
	 */
	init?: 'empty' | 'none';
}

/**
 * Creates a repository on branch `main` in a new directory under the operating system's
 * temporary directory, with a local identity. `dispose` removes it and any bare
 * repository created by `clone`. Disposing a clone removes only the clone.
 */
export async function tempRepo(options: TempRepoOptions = {}): Promise<TempRepo> {
	const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-'));
	const root = path.join(base, 'work');
	await fsp.mkdir(root);
	const repo = await createRepo(base, root, undefined);
	if (options.init !== 'none') {
		await repo.git(['init', '-b', 'main']);
		await configure(repo.git);
	}
	return repo;
}

async function configure(git: GitRunner): Promise<void> {
	for (const [key, value] of [['user.name', 'Test User'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) {
		await mustRun(git, ['config', key, value]);
	}
}

async function mustRun(git: GitRunner, args: string[]): Promise<string> {
	const result = await git(args);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout;
}

async function createRepo(base: string, root: string, sharedRemote: { path: string; owner: boolean } | undefined): Promise<TempRepo> {
	const rawGit = createGitRunner('git', root);
	const git: GitRunner = (args, options) => rawGit(args, { ...options, env: { ...ISOLATED_ENV, ...options?.env } });
	let current = START_TIME;
	let remote = sharedRemote;

	const clock: TestClock = {
		set: time => { current = time; },
		advance: milliseconds => { current = new Date(current.getTime() + milliseconds); },
	};

	const runNetwork = async (args: string[]): Promise<NetworkResult> => {
		const result = await git(args);
		if (result.exitCode === 0) {
			return { ok: true };
		}
		const detail = result.stderr.trim();
		if (/does not appear to be a git repository|No configured (push )?destination|No remote/i.test(detail)) {
			return { ok: false, reason: 'no-shared-copy', detail };
		}
		if (/non-fast-forward|fetch first|rejected/i.test(detail)) {
			return { ok: false, reason: 'shared-copy-moved', detail };
		}
		return { ok: false, reason: 'unknown', detail };
	};
	const network: NetworkPort = {
		// The host fetches with pruning (`engineHost.ts`).
		fetch: () => runNetwork(['fetch', '--prune']),
		push: branch => runNetwork(['push', 'origin', branch]),
		publish: (_remoteUrl, branch) => runNetwork(['push', '-u', 'origin', branch]),
	};

	let instances = 0;
	const makePorts = async (prefix: string): Promise<EnginePorts> => {
		const instanceGit = createGitRunner('git', root);
		let counter = 0;
		return {
			git: (args, options) => instanceGit(args, { ...options, env: { ...ISOLATED_ENV, ...options?.env } }),
			files: createNodeFilePort(root, [path.join(await fsp.realpath(root), '.git')]),
			network,
			now: () => new Date(current.getTime()),
			newId: () => `${prefix}-${++counter}`,
			projectRoot: root,
			openedFolder: root,
		};
	};
	const ports: EnginePorts = { ...await makePorts('op'), git };

	const repo: TempRepo = {
		root,
		git,
		ports,
		clock,
		async write(file, text) {
			const full = path.join(root, file);
			await fsp.mkdir(path.dirname(full), { recursive: true });
			await fsp.writeFile(full, text);
		},
		async read(file) {
			return fsp.readFile(path.join(root, file), 'utf8');
		},
		async commit(message) {
			const date = current.toISOString();
			await mustRun(git, ['add', '-A']);
			const result = await git(['commit', '--allow-empty', '-m', message], {
				env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
			});
			if (result.exitCode !== 0) {
				throw new Error(`git commit failed: ${result.stderr}${result.stdout}`);
			}
			return (await mustRun(git, ['rev-parse', 'HEAD'])).trim();
		},
		async clone() {
			if (!remote) {
				const bare = path.join(base, 'origin.git');
				await mustRun(createGitRunner('git', base), ['init', '--bare', '-b', 'main', bare]);
				await mustRun(git, ['remote', 'add', 'origin', bare]);
				await mustRun(git, ['config', 'branch.main.remote', 'origin']);
				await mustRun(git, ['config', 'branch.main.merge', 'refs/heads/main']);
				if ((await git(['rev-parse', '--verify', '-q', 'HEAD'])).exitCode === 0) {
					await mustRun(git, ['push', 'origin', 'main']);
				}
				remote = { path: bare, owner: true };
			}
			const cloneRoot = path.join(base, `clone-${++cloneCount}`);
			await mustRun(createGitRunner('git', base), ['clone', remote.path, cloneRoot]);
			const cloneRepo = await createRepo(base, cloneRoot, { path: remote.path, owner: false });
			await configure(cloneRepo.git);
			return cloneRepo;
		},
		async pushFrom(other) {
			await mustRun(other.git, ['push', 'origin', 'main']);
		},
		freshPorts() {
			return makePorts(`op${++instances}`);
		},
		async dispose() {
			// A clone removes only its own directory; the repository that made the shared
			// base removes the whole base.
			await fsp.rm(sharedRemote ? root : base, { recursive: true, force: true });
		},
	};
	return repo;
}

let cloneCount = 0;
