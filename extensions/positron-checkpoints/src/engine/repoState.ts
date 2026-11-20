/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as path from 'path';
import { GitMissingError, mustGit, runGit, splitZ } from './git';
import { EnginePorts, GitResult } from './ports';
import { sharedUpstream } from './proposals';
import { UnusualKind } from './types';

/** What the engine knows about the repository at one moment. */
export interface RepoFacts {
	/** True when the opened folder is inside a git work tree. */
	isProject: boolean;
	/** The top level of the work tree, or the opened folder when it is not a project. */
	root: string;
	/** The absolute git directory, or an empty string when it is not a project. */
	gitDir: string;
	branch?: string;
	/** Undefined for a repository with no checkpoints. */
	headCommit?: string;
	/** The shared copy's branch as git names it (see `sharedUpstream`); `ahead` and `behind` count against it. */
	upstream?: string;
	ahead: number;
	behind: number;
	identityMissing: boolean;
	/** True when `git merge-tree` supports `--merge-base` (git 2.40). */
	syncAvailable: boolean;
	unusual?: { kind: UnusualKind; detail: string };
}

/** Entries in the git directory that exist only while an operation is unfinished. */
const OPERATION_MARKERS = ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG'];

/**
 * Reads the repository facts for the folder the user opened. The top level comes from
 * `git rev-parse --show-toplevel` run in `openedFolder`; every later call runs in it. With
 * `options.syncAvailable`, that value is reported and git is not asked again. In a folder that
 * is not a project, `identityMissing` is git's answer for work in the opened folder.
 */
export async function readRepoFacts(ports: EnginePorts, options: { syncAvailable?: boolean } = {}): Promise<RepoFacts> {
	const notProject: RepoFacts = {
		isProject: false,
		root: ports.openedFolder,
		gitDir: '',
		ahead: 0,
		behind: 0,
		identityMissing: false,
		syncAvailable: false,
	};

	let top: GitResult;
	try {
		top = await runGit(ports.git, ['-C', ports.openedFolder, 'rev-parse', '--show-toplevel']);
	} catch (error) {
		if (error instanceof GitMissingError) {
			return { ...notProject, unusual: { kind: 'git-missing', detail: error.detail } };
		}
		throw error;
	}
	if (top.exitCode !== 0) {
		return { ...notProject, identityMissing: await isIdentityMissingIn(ports, ports.openedFolder) };
	}
	const root = stripLineEnd(top.stdout);
	const run = (args: string[], env?: Record<string, string>): Promise<GitResult> => runGit(ports.git, ['-C', root, ...args], env && { env });
	const must = (args: string[]): Promise<GitResult> => mustGit(ports.git, ['-C', root, ...args]);

	const gitDirResult = await run(['rev-parse', '--absolute-git-dir']);
	if (gitDirResult.exitCode !== 0) {
		return { ...notProject, identityMissing: await isIdentityMissingIn(ports, ports.openedFolder) };
	}
	const gitDir = stripLineEnd(gitDirResult.stdout);

	const symbolic = await run(['symbolic-ref', '-q', '--short', 'HEAD']);
	const branch = symbolic.exitCode === 0 ? symbolic.stdout.trim() : undefined;

	const head = await run(['rev-parse', '--verify', '-q', 'HEAD']);
	const headCommit = head.exitCode === 0 ? head.stdout.trim() : undefined;

	let upstream: string | undefined;
	let ahead = 0;
	let behind = 0;
	if (branch !== undefined) {
		const shared = await sharedUpstream({ ...ports, projectRoot: root }, branch);
		if (shared !== undefined && shared.name !== '') {
			upstream = shared.name;
			const counts = await run(['rev-list', '--left-right', '--count', `HEAD...${shared.commit}`]);
			if (counts.exitCode === 0) {
				const [left, right] = counts.stdout.trim().split(/\s+/).map(Number);
				ahead = left || 0;
				behind = right || 0;
			}
		}
	}

	const identityMissing = await isIdentityMissing(run);

	const syncAvailable = options.syncAvailable ?? await isSyncAvailable(ports, root);

	return {
		isProject: true,
		root,
		gitDir,
		branch,
		headCommit,
		upstream,
		ahead,
		behind,
		identityMissing,
		syncAvailable,
		unusual: await findUnusual(must, root, gitDir, branch === undefined),
	};
}

/** True when `git merge-tree` supports `--merge-base` (git 2.40), as git's own help for the command says. */
export async function isSyncAvailable(ports: EnginePorts, root = ports.projectRoot): Promise<boolean> {
	const help = await runGit(ports.git, ['-C', root, 'merge-tree', '-h']);
	// Git prints the option as `--[no-]merge-base`.
	return /--(\[no-\])?merge-base/.test(help.stdout + help.stderr);
}

/**
 * True unless git has an explicit identity (see `isIdentityMissing`) for work in `folder`, which
 * need not be a repository.
 */
export async function isIdentityMissingIn(ports: EnginePorts, folder: string): Promise<boolean> {
	return isIdentityMissing((args, env) => runGit(ports.git, ['-C', folder, ...args], env && { env }));
}

/**
 * True unless git has both a name and an email, for the author and for the committer, that
 * were set explicitly (in configuration or through `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, or `EMAIL`). Without `user.useConfigOnly`
 * git guesses an address such as `user@host.local`, which must not author checkpoints.
 */
async function isIdentityMissing(run: (args: string[], env?: Record<string, string>) => Promise<GitResult>): Promise<boolean> {
	// With `user.useConfigOnly` git ignores `EMAIL`, so pass it as an explicit address.
	const email = process.env.EMAIL;
	const env: Record<string, string> = {};
	if (email) {
		// Git ignores EMAIL for the committer under `user.useConfigOnly`, so both are explicit.
		if (!process.env.GIT_AUTHOR_EMAIL) {
			env.GIT_AUTHOR_EMAIL = email;
		}
		if (!process.env.GIT_COMMITTER_EMAIL) {
			env.GIT_COMMITTER_EMAIL = email;
		}
	}
	for (const variable of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
		const result = await run(['-c', 'user.useConfigOnly=true', 'var', variable], env);
		if (result.exitCode !== 0 || result.stdout.trim() === '') {
			return true;
		}
	}
	return false;
}

async function findUnusual(
	must: (args: string[]) => Promise<GitResult>,
	root: string,
	gitDir: string,
	detached: boolean,
): Promise<RepoFacts['unusual']> {
	for (const marker of OPERATION_MARKERS) {
		if (await exists(path.join(gitDir, marker))) {
			return { kind: 'operation-in-progress', detail: marker };
		}
	}
	if (detached) {
		return { kind: 'detached', detail: 'HEAD does not point at a branch' };
	}
	// A path is unusual when the index differs from HEAD (someone staged it) and the
	// working file differs from the index (the staged content is not what is on disk).
	const staged = await must(['diff', '--cached', '--name-only', '-z']);
	if (staged.stdout !== '') {
		const modified = new Set(splitZ((await must(['diff', '--name-only', '-z'])).stdout));
		const both = splitZ(staged.stdout).filter(file => modified.has(file));
		if (both.length > 0) {
			return { kind: 'staged-differs', detail: both.join(', ') };
		}
	}
	// A staged deletion whose file exists again is untracked, so `git diff` does not list it.
	// Without rename detection the source of a staged rename counts as a deletion too.
	const deleted = await must(['diff', '--cached', '--no-renames', '--name-only', '--diff-filter=D', '-z']);
	const recreated: string[] = [];
	for (const file of splitZ(deleted.stdout)) {
		if (await exists(path.join(root, file))) {
			recreated.push(file);
		}
	}
	if (recreated.length > 0) {
		return { kind: 'staged-differs', detail: recreated.join(', ') };
	}
	return undefined;
}

/** Removes the line terminator git adds to a path, and nothing else (a path may end in a space). */
function stripLineEnd(output: string): string {
	return output.replace(/\r?\n$/, '');
}

async function exists(file: string): Promise<boolean> {
	try {
		await fsp.lstat(file);
		return true;
	} catch {
		return false;
	}
}
