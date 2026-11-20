/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { GitTimeoutError, mustGit, runGit, splitZ } from './git';
import { engineDirectory, PathPlan, readDiskEntries } from './journal';
import { EnginePorts } from './ports';
import { fileMode } from './runOperation';
import { withTempIndex, worktreeTree } from './trees';

/** A project check (a hook) runs arbitrary code; one that runs longer than this is stopped and rejects the checkpoint. */
export const HOOK_TIMEOUT_MS = 10 * 60_000;

export interface CandidateResult {
	outcome: 'ok' | 'rejected';
	/** The output of the hook that rejected the checkpoint, or git's error text; empty when ok. */
	output: string;
	approvedTree: string;
	/** The tree of the temporary index after `pre-commit`; the approved tree when `pre-commit` rejected. */
	resultTree: string;
	/** The message as the hooks left it, cleaned with `git stripspace`. */
	message: string;
	/** The candidate commit; absent when rejected. */
	candidate?: string;
	/** Working files a hook changed on disk: `before` from the snapshot tree, `after` from disk. */
	hookEdited: PathPlan[];
}

/**
 * Builds a candidate checkpoint (spec 6.1, steps 4 and 5). The hooks run in git's order, each
 * with `git hook run --ignore-missing`, in the project root, and with `GIT_INDEX_FILE` set to
 * a temporary index that starts with `approvedTree`: `pre-commit`, after which the tree is
 * written again; `prepare-commit-msg` with the message file and the source `message`; then
 * `commit-msg` with the message file. The commit is made with `git commit-tree` from that tree
 * and the cleaned message, with `parent` as its parent when given, and signed (`-S`) when
 * `commit.gpgsign` is true. No ref is created or moved, and the real index is never used.
 *
 * A hook that exits with an error or runs longer than `HOOK_TIMEOUT_MS`, a message that is
 * empty after the hooks, and a `commit-tree` that fails (a signing failure, for example) give
 * `rejected` with the output that explains it and no candidate. In every case, `hookEdited`
 * lists the working files that differ from `snapshotTree` after the hooks ran, with the blob
 * id of each file on disk as `readDiskEntries` defines it.
 */
export async function buildCandidate(
	ports: EnginePorts,
	input: { parent: string | null; approvedTree: string; title: string; body: string; snapshotTree: string },
): Promise<CandidateResult> {
	const git = (args: string[], options?: Parameters<EnginePorts['git']>[1]) => mustGit(ports.git, ['-C', ports.projectRoot, ...args], options);
	const messageFile = `${await engineDirectory(ports)}/tmp/message-${randomUUID()}`;
	const composed = input.body.trim() === '' ? `${input.title}\n` : `${input.title}\n\n${input.body}\n`;
	try {
		return await withTempIndex(ports, async env => {
			let resultTree = input.approvedTree;
			const finish = async (outcome: CandidateResult['outcome'], output: string, message: string, candidate?: string): Promise<CandidateResult> => {
				const result: CandidateResult = {
					outcome, output, approvedTree: input.approvedTree, resultTree, message,
					hookEdited: await hookEdits(ports, input.snapshotTree),
				};
				if (candidate !== undefined) {
					result.candidate = candidate;
				}
				return result;
			};

			// The temporary folder exists once `withTempIndex` runs.
			await ports.files.write(messageFile, Buffer.from(composed, 'utf8'), false);
			await git(['read-tree', input.approvedTree], { env });

			const preCommit = await runHook(ports, env, 'pre-commit', []);
			if (preCommit !== undefined) {
				return finish('rejected', preCommit, await readMessage(ports, messageFile));
			}
			resultTree = (await git(['write-tree'], { env })).stdout.trim();
			for (const [name, args] of [['prepare-commit-msg', [messageFile, 'message']], ['commit-msg', [messageFile]]] as const) {
				const failed = await runHook(ports, env, name, [...args]);
				if (failed !== undefined) {
					return finish('rejected', failed, await readMessage(ports, messageFile));
				}
			}

			const message = await readMessage(ports, messageFile);
			if (message === '') {
				return finish('rejected', 'The checkpoint description is empty after the project checks ran.', message);
			}
			const sign = (await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--type=bool', '--get', 'commit.gpgsign'])).stdout.trim() === 'true';
			const date = ports.now().toISOString();
			const commit = await runGit(ports.git, [
				'-C', ports.projectRoot, 'commit-tree', resultTree,
				...(input.parent === null ? [] : ['-p', input.parent]),
				...(sign ? ['-S'] : []),
			], { stdin: message, env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, timeoutMs: HOOK_TIMEOUT_MS });
			if (commit.exitCode !== 0) {
				return finish('rejected', commit.stderr.trim(), message);
			}
			return finish('ok', '', message, commit.stdout.trim());
		});
	} finally {
		await ports.files.remove(messageFile).catch(() => undefined);
	}
}

/**
 * Runs one hook with `git hook run --ignore-missing`. Returns undefined when it passes (or
 * does not exist), and the hook's output (stdout, then stderr) when it fails or runs longer
 * than `HOOK_TIMEOUT_MS`.
 */
async function runHook(ports: EnginePorts, env: Record<string, string>, name: string, args: string[]): Promise<string | undefined> {
	let result;
	try {
		result = await runGit(ports.git, ['-C', ports.projectRoot, 'hook', 'run', '--ignore-missing', name, ...(args.length === 0 ? [] : ['--', ...args])], {
			env,
			timeoutMs: HOOK_TIMEOUT_MS,
		});
	} catch (error) {
		if (error instanceof GitTimeoutError) {
			return `The project check "${name}" did not finish within 10 minutes and was stopped.`;
		}
		throw error;
	}
	if (result.exitCode === 0) {
		return undefined;
	}
	return [result.stdout, result.stderr].filter(text => text.trim() !== '').join('\n').trim() || `The project check "${name}" failed with exit code ${result.exitCode}.`;
}

/** The message file as the hooks left it, cleaned with `git stripspace`. */
async function readMessage(ports: EnginePorts, messageFile: string): Promise<string> {
	const content = await ports.files.read(messageFile);
	if (content === undefined) {
		return '';
	}
	return (await mustGit(ports.git, ['-C', ports.projectRoot, 'stripspace'], { stdin: content })).stdout;
}

/**
 * The working files that differ from `snapshotTree` now: the paths that differ between it and
 * a fresh working-file tree, each with its snapshot entry as `before` and what is on disk as
 * `after` (null when removed), read with `readDiskEntries`. Submodules and paths that are a
 * folder on disk now are left out.
 */
async function hookEdits(ports: EnginePorts, snapshotTree: string): Promise<PathPlan[]> {
	const { tree } = await worktreeTree(ports);
	if (tree === snapshotTree) {
		return [];
	}
	const fields = splitZ((await mustGit(ports.git, ['-C', ports.projectRoot, 'diff-tree', '-r', '-z', '--no-renames', snapshotTree, tree])).stdout);
	const plans: PathPlan[] = [];
	for (let index = 0; index + 1 < fields.length; index += 2) {
		// `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path.
		const [oldMode, newMode, oldBlob] = fields[index].slice(1).split(' ');
		const beforeMode = fileMode(oldMode);
		if (beforeMode === undefined || fileMode(newMode) === undefined) {
			continue;
		}
		plans.push({ path: fields[index + 1], before: beforeMode === null ? null : oldBlob, after: null, beforeMode, afterMode: null });
	}
	const disk = await readDiskEntries(ports, plans);
	const edited: PathPlan[] = [];
	for (const plan of plans) {
		const entry = disk.get(plan.path);
		if (entry === undefined || entry === 'other') {
			continue;
		}
		const after = entry === null ? null : entry.blob;
		const afterMode = entry === null ? null : entry.mode;
		if (after !== plan.before || afterMode !== plan.beforeMode) {
			edited.push({ ...plan, after, afterMode });
		}
	}
	return edited;
}
