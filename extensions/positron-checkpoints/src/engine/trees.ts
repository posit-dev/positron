/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { mustGit as mustGitRunner, splitZ } from './git';
import { EnginePorts } from './ports';

/** Untracked files larger than this are left out of snapshots. */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

/** The prefix of every snapshot ref. */
export const SNAPSHOT_REF_PREFIX = 'refs/positron-checkpoints/snapshots/';

/** The prefix of the snapshot of a project as it was before an interrupted operation was reversed. */
export const RECOVERY_REF_PREFIX = 'refs/positron-checkpoints/recovery/';

const SNAPSHOT_IDENTITY = {
	GIT_AUTHOR_NAME: 'Positron Checkpoints',
	GIT_AUTHOR_EMAIL: 'checkpoints@positron.invalid',
	GIT_COMMITTER_NAME: 'Positron Checkpoints',
	GIT_COMMITTER_EMAIL: 'checkpoints@positron.invalid',
};

/** Runs git in the project root and throws when it exits with an error. */
async function mustGit(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGitRunner(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

/** Hashing a large tracked file can take much longer than the default limit. */
export const STAGING_TIMEOUT_MS = 10 * 60_000;

/**
 * The absolute git directory. Git ends a path with a line terminator, and a path may itself
 * end in a space.
 */
export async function absoluteGitDir(ports: EnginePorts): Promise<string> {
	return (await mustGit(ports, ['rev-parse', '--absolute-git-dir'])).replace(/\r?\n$/, '');
}

/**
 * Runs `fn` with `GIT_INDEX_FILE` pointing at a temporary index inside the git directory's
 * `positron-checkpoints/tmp` folder, so the real index is never touched. The index file is
 * removed afterwards, whether `fn` succeeds or not.
 */
export async function withTempIndex<T>(ports: EnginePorts, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
	const gitDir = await absoluteGitDir(ports);
	const folder = `${gitDir}/positron-checkpoints/tmp`;
	const indexFile = `${folder}/index-${randomUUID()}`;
	// Appending an empty line to a marker file creates the folder.
	await ports.files.appendDurable(`${folder}/.keep`, '');
	try {
		return await fn({ GIT_INDEX_FILE: indexFile });
	} finally {
		await ports.files.remove(indexFile);
		await ports.files.remove(`${indexFile}.lock`);
	}
}

/**
 * Builds a tree of every tracked file (with its current content) and every untracked file
 * that is not ignored, without changing the real index. An untracked file over
 * `largeFileBytes` is left out and listed in `skipped`; its size comes from `stat`, so git
 * never reads it. A tracked file is kept at any size. Executable bits and symbolic links are
 * kept as git records them.
 */
export async function worktreeTree(ports: EnginePorts, largeFileBytes = LARGE_FILE_BYTES): Promise<{ tree: string; skipped: string[] }> {
	const gitDir = await absoluteGitDir(ports);
	const untracked = splitZ(await mustGit(ports, ['ls-files', '-z', '--others', '--exclude-standard']));
	const included: string[] = [];
	const skipped: string[] = [];
	for (const file of untracked) {
		// A symbolic link is stored as a link, whatever its target's size.
		const info = await ports.files.lstat(file);
		if (info !== undefined && !info.isDirectory && !info.isSymbolicLink && info.sizeBytes > largeFileBytes) {
			skipped.push(file);
		} else {
			included.push(file);
		}
	}

	const tree = await withTempIndex(ports, async env => {
		// Start from the real index so tracked paths (including newly staged ones) are known.
		if (await ports.files.stat(`${gitDir}/index`) !== undefined) {
			await ports.files.copyKeepingTime(`${gitDir}/index`, env.GIT_INDEX_FILE);
		}
		// A copied assume-unchanged or skip-worktree flag makes `add -u` skip an edited file.
		// A skip-worktree path that is absent on disk is outside a sparse checkout and stays flagged.
		const entries = splitZ(await mustGit(ports, ['ls-files', '-v', '-z'], { env }));
		const assumed = entries.filter(entry => /^[a-z] /.test(entry)).map(entry => entry.slice(2));
		const present = await Promise.all(entries
			.filter(entry => /^[Ss] /.test(entry))
			.map(async entry => (await ports.files.lstat(entry.slice(2))) === undefined ? undefined : entry.slice(2)));
		const skipped = present.filter((file): file is string => file !== undefined);
		for (const [flag, paths] of [['--no-assume-unchanged', assumed], ['--no-skip-worktree', skipped]] as const) {
			if (paths.length > 0) {
				await mustGit(ports, ['update-index', flag, '-z', '--stdin'], { env, stdin: paths.join('\0') + '\0' });
			}
		}
		await mustGit(ports, ['add', '-u'], { env, timeoutMs: STAGING_TIMEOUT_MS });
		if (included.length > 0) {
			await mustGit(ports, ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
				env,
				stdin: included.join('\0') + '\0',
				timeoutMs: STAGING_TIMEOUT_MS,
			});
		}
		return (await mustGit(ports, ['write-tree'], { env, timeoutMs: STAGING_TIMEOUT_MS })).trim();
	});
	return { tree, skipped };
}

/** The tree of the real index (`git write-tree`). */
export async function indexTree(ports: EnginePorts): Promise<string> {
	return (await mustGit(ports, ['write-tree'])).trim();
}

/**
 * Records the working files and the index as they are now. The snapshot is a commit whose
 * tree is the working-file tree, stored at `<refPrefix><operationId>` (by default
 * `refs/positron-checkpoints/snapshots/<operationId>`, a ref git never pushes). A second commit holds the index tree and is the snapshot's last
 * parent, so every object of both trees stays reachable from the ref (the first parent, when
 * given, comes before it). The ref must not exist yet: a reused operation id is an error.
 * Snapshot commits are never signed.
 */
export async function saveSnapshot(
	ports: EnginePorts,
	operationId: string,
	parent?: string,
	refPrefix = SNAPSHOT_REF_PREFIX,
): Promise<{ ref: string; commit: string; worktreeTree: string; indexTree: string; skipped: string[] }> {
	const { tree, skipped } = await worktreeTree(ports);
	const index = await indexTree(ports);
	const date = ports.now().toISOString();
	const env = { ...SNAPSHOT_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
	const indexCommit = (await mustGit(ports, ['commit-tree', '--no-gpg-sign', index, '-m', `Index of snapshot ${operationId}`], { env })).trim();
	const args = ['commit-tree', '--no-gpg-sign', tree];
	if (parent !== undefined) {
		args.push('-p', parent);
	}
	args.push('-p', indexCommit, '-m', `Snapshot ${operationId}`);
	const commit = (await mustGit(ports, args, { env })).trim();
	const ref = `${refPrefix}${operationId}`;
	// The all-zero old value makes git refuse to replace an existing ref.
	await mustGit(ports, ['update-ref', ref, commit, '0'.repeat(commit.length)]);
	return { ref, commit, worktreeTree: tree, indexTree: index, skipped };
}
