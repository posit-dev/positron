/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { GitTimeoutError, mustGit, runGit, splitZ } from './git';
import { PathPlan, readDiskEntries } from './journal';
import { EnginePorts } from './ports';
import { fileMode } from './runOperation';
import { absoluteGitDir, withTempIndex, worktreeTree } from './trees';

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
	/**
	 * Working files a hook changed on disk: `before` from the baseline tree, `after` from disk
	 * (null for a file that is gone, or that a folder replaced).
	 */
	hookEdited: PathPlan[];
	/** The working-file tree the edits are measured from (see `buildCandidate`). */
	baselineTree: string;
}

/**
 * Builds a candidate checkpoint (spec 6.1, steps 4 and 5). The hooks run in git's order, each
 * with `git hook run --ignore-missing`, in the project root, and with `GIT_INDEX_FILE` set to
 * a temporary index that starts with `approvedTree`: `pre-commit`, after which the tree is
 * written again; `prepare-commit-msg` with the message file and the source `message`; then
 * `commit-msg` with the message file. The message file is `<git dir>/COMMIT_EDITMSG`, as for
 * `git commit`, so a hook that reads that file directly sees the message; its earlier content is
 * put back afterwards (or the file removed when there was none). `GIT_EDITOR` is `:`, so a hook
 * that opens an editor never waits. The commit is made with `git commit-tree` from that tree
 * and the cleaned message, with `parent` as its parent when given, and signed (`-S`) when
 * `commit.gpgsign` is true. No ref is created or moved, and the real index is never used.
 *
 * A hook that exits with an error or runs longer than `HOOK_TIMEOUT_MS`, a message that is
 * empty after the hooks, and a `commit-tree` that fails (a signing failure, for example) give
 * `rejected` with the output that explains it and no candidate. In every case, `hookEdited`
 * lists the working files that differ from the baseline tree after the hooks ran, with the blob
 * id of each file on disk as `readDiskEntries` defines it. The baseline is `baselineTree` when
 * given (the baseline of an earlier chunk of the same request), and otherwise a working-file
 * tree read immediately before `pre-commit` starts, so an edit the person made earlier is never
 * taken for a hook's.
 */
export async function buildCandidate(
	ports: EnginePorts,
	input: { parent: string | null; approvedTree: string; title: string; body: string; baselineTree?: string },
): Promise<CandidateResult> {
	const git = (args: string[], options?: Parameters<EnginePorts['git']>[1]) => mustGit(ports.git, ['-C', ports.projectRoot, ...args], options);
	const messageFile = `${await absoluteGitDir(ports)}/COMMIT_EDITMSG`;
	const previousMessage = await ports.files.read(messageFile);
	const composed = input.body.trim() === '' ? `${input.title}\n` : `${input.title}\n\n${input.body}\n`;
	try {
		return await withTempIndex(ports, async indexEnv => {
			const env = { ...indexEnv, GIT_EDITOR: ':' };
			await ports.files.write(messageFile, Buffer.from(composed, 'utf8'), false);
			await git(['read-tree', input.approvedTree], { env });
			const baselineTree = input.baselineTree ?? (await worktreeTree(ports)).tree;

			let resultTree = input.approvedTree;
			const finish = async (outcome: CandidateResult['outcome'], output: string, message: string, candidate?: string): Promise<CandidateResult> => {
				const result: CandidateResult = {
					outcome, output, approvedTree: input.approvedTree, resultTree, message,
					hookEdited: await hookEdits(ports, baselineTree), baselineTree,
				};
				if (candidate !== undefined) {
					result.candidate = candidate;
				}
				return result;
			};

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
				return finish('rejected', 'The description of the version is empty after the project checks ran.', message);
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
		await (previousMessage === undefined ? ports.files.remove(messageFile) : ports.files.write(messageFile, previousMessage, false)).catch(() => undefined);
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
 * The working files that differ from `baselineTree` now: the paths that differ between it and
 * a fresh working-file tree, each with its baseline entry as `before` and what is on disk as
 * `after` (null when removed, or when a folder now has its place), read with
 * `readDiskEntries`. A folder that replaced a file is listed under the file's path, and its
 * files under theirs; a file that replaced a folder is listed, and so are the folder's files.
 * Submodules are left out.
 */
async function hookEdits(ports: EnginePorts, baselineTree: string): Promise<PathPlan[]> {
	const { tree } = await worktreeTree(ports);
	if (tree === baselineTree) {
		return [];
	}
	const fields = splitZ((await mustGit(ports.git, ['-C', ports.projectRoot, 'diff-tree', '-r', '-z', '--no-renames', baselineTree, tree])).stdout);
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
		if (entry === 'other' && plan.before !== null && (await ports.files.lstat(plan.path))?.isDirectory) {
			edited.push({ ...plan, after: null, afterMode: null });
			continue;
		}
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
