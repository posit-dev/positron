/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readCommit, resolveCommit } from './checkpoints';
import { mustGit, runGit, splitZ } from './git';
import { readBranch, readIndexTree, TriState } from './journal';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { runOperation } from './runOperation';
import { STAGING_TIMEOUT_MS, withTempIndex, worktreeTree } from './trees';
import { CollisionChoice, OperationResult } from './types';

/** Runs git in the project root and throws when it exits with an error. */
async function git(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGit(ports.git, ['-C', ports.projectRoot, ...args], { timeoutMs: STAGING_TIMEOUT_MS, ...options })).stdout;
}

/** One entry of `git ls-tree -r -z`: the whole line for `update-index --index-info`, and its path. */
interface TreeEntry { line: string; path: string }

/** Every file entry of `tree`, recursively. */
async function treeEntries(ports: EnginePorts, tree: string): Promise<TreeEntry[]> {
	return splitZ(await git(ports, ['ls-tree', '-r', '-z', tree])).map(line => ({ line, path: line.slice(line.indexOf('\t') + 1) }));
}

/**
 * Makes the working files match the checkpoint `id` (spec 6.5). History, the branch, and the
 * index do not change, so the difference appears under "Changes since your last checkpoint".
 *
 * The working files' after tree is the checkpoint's tree, plus each file of the current
 * working-file tree that is untracked (not in HEAD) and whose path the checkpoint's tree does not
 * use, so untracked files stay where they are. An untracked file at a path the checkpoint's tree
 * has a file at is replaced by the checkpoint's version; the operation's snapshot covers it, so
 * Undo returns it. An untracked file that would need to be a folder of the checkpoint, or that
 * sits inside a path that is a file in the checkpoint, is left out of the after tree, so writing
 * the checkpoint's file at that place stops the operation and nothing changes.
 *
 * The change runs through `runOperation` as a `go-back` operation, with its collision check
 * (`path-collisions` for files outside the snapshot without a choice in `collisionChoices`), and
 * is noted in the undo list. Returns:
 *
 * - `nothing-to-do not-in-history` when `id` is not the full id of a commit in the history of
 *   the current branch;
 * - `nothing-to-do unchanged` when the working files already match;
 * - `unavailable unusual-state` when HEAD is detached or the index cannot be read, and with detail
 *   `staged-work` when the index differs from the latest checkpoint, because files written under
 *   staged work would leave a staged version that differs from the file on disk.
 */
export async function goBackTo(ports: EnginePorts, id: string, collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const ref = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	const indexTree = await readIndexTree(ports);
	if (!ref.startsWith('refs/heads/') || indexTree === undefined) {
		return { kind: 'unavailable', reason: 'unusual-state' };
	}
	const head = await readBranch(ports, ref.slice('refs/heads/'.length));
	const target = await resolveCommit(ports, id);
	if (head === null || target === undefined
		|| (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', '--is-ancestor', target, head])).exitCode !== 0) {
		return { kind: 'unavailable', reason: 'nothing-to-do', detail: 'not-in-history' };
	}
	const headTree = (await git(ports, ['rev-parse', `${head}^{tree}`])).trim();
	if (indexTree !== headTree) {
		return { kind: 'unavailable', reason: 'unusual-state', detail: 'staged-work' };
	}

	const current = (await worktreeTree(ports)).tree;
	const targetTree = (await git(ports, ['rev-parse', `${target}^{tree}`])).trim();
	const after = await withUntrackedFiles(ports, targetTree, current, headTree);
	if (after === current) {
		return { kind: 'unavailable', reason: 'nothing-to-do', detail: 'unchanged' };
	}

	const expected: TriState = { branchCommit: head, indexTree, worktreeTree: current };
	const title = (await readCommit(ports, target)).message.toString('utf8').split('\n')[0];
	const result = await runOperation(ports, {
		kind: 'go-back', description: `Go back to "${title}"`, expected,
		after: { branchCommit: head, indexTree, worktreeTree: after },
		collisionChoices,
	});
	if (result.kind === 'done') {
		await noteNewOperation(ports, 'go-back');
	}
	return result;
}

/**
 * `checkpointTree` with the entries of `worktree` whose paths are not in `headTree` added, except
 * an entry whose path the checkpoint's tree has, or one that would put a file and a folder at
 * the same path.
 */
async function withUntrackedFiles(ports: EnginePorts, checkpointTree: string, worktree: string, headTree: string): Promise<string> {
	const tracked = new Set((await treeEntries(ports, headTree)).map(entry => entry.path));
	const checkpointFiles = new Set((await treeEntries(ports, checkpointTree)).map(entry => entry.path));
	const checkpointFolders = new Set<string>();
	for (const file of checkpointFiles) {
		for (let end = file.lastIndexOf('/'); end > 0; end = file.lastIndexOf('/', end - 1)) {
			checkpointFolders.add(file.slice(0, end));
		}
	}
	const insideCheckpointFile = (file: string) => {
		for (let end = file.lastIndexOf('/'); end > 0; end = file.lastIndexOf('/', end - 1)) {
			if (checkpointFiles.has(file.slice(0, end))) {
				return true;
			}
		}
		return false;
	};
	const untracked = (await treeEntries(ports, worktree)).filter(entry =>
		!tracked.has(entry.path) && !checkpointFiles.has(entry.path) && !checkpointFolders.has(entry.path) && !insideCheckpointFile(entry.path));
	if (untracked.length === 0) {
		return checkpointTree;
	}
	return withTempIndex(ports, async env => {
		await git(ports, ['read-tree', checkpointTree], { env });
		// `ls-tree` lines are `<mode> <type> <object>\t<path>`; `--index-info` reads the same form.
		await git(ports, ['update-index', '-z', '--index-info'], { env, stdin: untracked.map(entry => entry.line).join('\0') + '\0' });
		return (await git(ports, ['write-tree'], { env })).trim();
	});
}
