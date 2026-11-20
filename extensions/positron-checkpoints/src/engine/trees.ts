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
const STAGING_TIMEOUT_MS = 10 * 60_000;

/** Git ends a path with a line terminator, and a path may itself end in a space. */
async function absoluteGitDir(ports: EnginePorts): Promise<string> {
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
		const realIndex = await ports.files.read(`${gitDir}/index`);
		if (realIndex !== undefined) {
			await ports.files.write(env.GIT_INDEX_FILE, realIndex, false);
		}
		// A copied assume-unchanged flag makes `add -u` skip an edited file.
		const flagged = splitZ(await mustGit(ports, ['ls-files', '-v', '-z'], { env }))
			.filter(entry => /^[a-z] /.test(entry))
			.map(entry => entry.slice(2));
		if (flagged.length > 0) {
			await mustGit(ports, ['update-index', '--no-assume-unchanged', '-z', '--stdin'], { env, stdin: flagged.join('\0') + '\0' });
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
 * tree is the working-file tree, stored at `refs/positron-checkpoints/snapshots/<operationId>`
 * (a ref git never pushes). A second commit holds the index tree and is the snapshot's last
 * parent, so every object of both trees stays reachable from the ref (the first parent, when
 * given, comes before it). The ref must not exist yet: a reused operation id is an error.
 * Snapshot commits are never signed.
 */
export async function saveSnapshot(
	ports: EnginePorts,
	operationId: string,
	parent?: string,
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
	const ref = `${SNAPSHOT_REF_PREFIX}${operationId}`;
	// The all-zero old value makes git refuse to replace an existing ref.
	await mustGit(ports, ['update-ref', ref, commit, '0'.repeat(commit.length)]);
	return { ref, commit, worktreeTree: tree, indexTree: index, skipped };
}
