/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { runGit, splitZ } from './git';
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
	const result = await runGit(ports.git, ['-C', ports.projectRoot, ...args], options);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
	}
	return result.stdout;
}

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
		const info = await ports.files.stat(file);
		if (info !== undefined && !info.isDirectory && info.sizeBytes > largeFileBytes) {
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
		await mustGit(ports, ['add', '-u'], { env });
		if (included.length > 0) {
			await mustGit(ports, ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], {
				env,
				stdin: included.join('\0') + '\0',
			});
		}
		return (await mustGit(ports, ['write-tree'], { env })).trim();
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
 * (a ref git never pushes). The message ends with an `Index-Tree:` line naming the index tree.
 */
export async function saveSnapshot(
	ports: EnginePorts,
	operationId: string,
	parent?: string,
): Promise<{ ref: string; commit: string; worktreeTree: string; indexTree: string; skipped: string[] }> {
	const { tree, skipped } = await worktreeTree(ports);
	const index = await indexTree(ports);
	const date = ports.now().toISOString();
	const args = ['commit-tree', tree];
	if (parent !== undefined) {
		args.push('-p', parent);
	}
	args.push('-m', `Snapshot ${operationId}\n\nIndex-Tree: ${index}`);
	const commit = (await mustGit(ports, args, {
		env: { ...SNAPSHOT_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
	})).trim();
	const ref = `${SNAPSHOT_REF_PREFIX}${operationId}`;
	await mustGit(ports, ['update-ref', ref, commit]);
	return { ref, commit, worktreeTree: tree, indexTree: index, skipped };
}
