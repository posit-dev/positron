/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { ChunkError, emptyTree, readChangesDetailed, treeForChunk } from './changes';
import { GitFailedError, mustGit, runGit, splitZ } from './git';
import { buildCandidate, CandidateResult, HOOK_TIMEOUT_MS } from './hooks';
import {
	acquireLock, classifyPaths, engineDirectory, JournalRecord, PathPlan, readBranch, readIndexTree, readRecords, setStatus, TriState, writeRecord,
} from './journal';
import { noteNewOperation } from './operationLog';
import { EnginePorts } from './ports';
import { runOperation } from './runOperation';
import { worktreeTree } from './trees';
import { Chunk, EngineState, OperationKind, OperationResult, Overlap, OverlapKind } from './types';

/** A checkpoint title is one line of at most this many characters. */
export const TITLE_LIMIT = 72;

/** The prefix of the ref that keeps the candidate of a pending approval. */
export const PENDING_REF_PREFIX = 'refs/positron-checkpoints/pending/';

/** An abbreviated or full object id. Anything else is never passed to git as a revision. */
const OBJECT_ID = /^[0-9a-f]{4,64}$/i;

/** Git keeps reading a file as text when its first this many bytes have no NUL byte. */
const BINARY_PROBE_BYTES = 8000;

/** The identity of commits that exist only in the object database, as inputs to `git merge-tree`. */
const TEMPORARY_IDENTITY = {
	GIT_AUTHOR_NAME: 'Positron Checkpoints',
	GIT_AUTHOR_EMAIL: 'checkpoints@positron.invalid',
	GIT_COMMITTER_NAME: 'Positron Checkpoints',
	GIT_COMMITTER_EMAIL: 'checkpoints@positron.invalid',
};

/** The two parts of a project that publishing checkpoints moves. Working files never change. */
interface Published { branchCommit: string | null; indexTree: string }

/** Runs git in the project root and throws when it exits with an error. */
async function git(ports: EnginePorts, args: string[], options?: Parameters<EnginePorts['git']>[1]): Promise<string> {
	return (await mustGit(ports.git, ['-C', ports.projectRoot, ...args], options)).stdout;
}

function nothingToDo(detail: string): OperationResult {
	return { kind: 'unavailable', reason: 'nothing-to-do', detail };
}

const UNUSUAL: OperationResult = { kind: 'unavailable', reason: 'unusual-state' };

/** True for an empty title, a title over the limit, or a title of more than one line. */
function isBadTitle(title: string): boolean {
	return title.trim() === '' || title.length > TITLE_LIMIT || /[\r\n]/.test(title);
}

/** The title, then a blank line and the body when there is one. */
function composeMessage(title: string, body: string): string {
	return body.trim() === '' ? `${title}\n` : `${title}\n\n${body}\n`;
}

/** The name of the branch HEAD points at, or undefined when HEAD is detached. */
async function currentBranch(ports: EnginePorts): Promise<string | undefined> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const ref = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : undefined;
}

/** `-S` when `commit.gpgsign` is set, so new commits follow the person's signing rule. */
async function signArgs(ports: EnginePorts): Promise<string[]> {
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'config', '--type=bool', '--get', 'commit.gpgsign']);
	return result.stdout.trim() === 'true' ? ['-S'] : [];
}

/** The paths that differ between two trees. */
async function treeDifference(ports: EnginePorts, left: string, right: string): Promise<string[]> {
	return splitZ(await git(ports, ['diff-tree', '-r', '-z', '--name-only', '--no-renames', left, right]));
}

// --- Partial files --------------------------------------------------------------------------

async function metaFile(ports: EnginePorts): Promise<string> {
	return `${await engineDirectory(ports)}/meta.jsonl`;
}

/**
 * Saves the files a checkpoint took only part of, as one line of `meta.jsonl`. Nothing is
 * saved for a checkpoint made of whole files. Each line starts with a line break, so a line a
 * crash cut short never joins the next one.
 */
async function savePartialFiles(ports: EnginePorts, commit: string, partialFiles: string[]): Promise<void> {
	if (partialFiles.length > 0) {
		await ports.files.appendDurable(await metaFile(ports), '\n' + JSON.stringify({ commit, partialFiles }));
	}
}

/** The files each checkpoint took only part of, by commit id. Unreadable lines are ignored. */
export async function readPartialFiles(ports: EnginePorts): Promise<Map<string, string[]>> {
	const content = await ports.files.read(await metaFile(ports));
	const partial = new Map<string, string[]>();
	if (content === undefined) {
		return partial;
	}
	for (const line of Buffer.from(content).toString('utf8').split('\n')) {
		try {
			const entry = JSON.parse(line) as { commit?: unknown; partialFiles?: unknown };
			if (typeof entry.commit === 'string' && Array.isArray(entry.partialFiles)) {
				partial.set(entry.commit, entry.partialFiles.filter((file): file is string => typeof file === 'string'));
			}
		} catch {
			// An empty line or the end of a crash.
		}
	}
	return partial;
}

// --- Publishing ------------------------------------------------------------------------------

/**
 * Moves the branch and the index from `from` to `to` through `runOperation`, with the working
 * files unchanged apart from `extraPaths` (files a hook already changed on disk). The working
 * files the plan expects are read now. A finished operation is noted in the undo list.
 */
async function publish(ports: EnginePorts, kind: OperationKind, description: string, from: Published, to: Published, extraPaths: PathPlan[]): Promise<OperationResult> {
	const worktree = (await worktreeTree(ports)).tree;
	const result = await runOperation(ports, {
		kind, description,
		expected: { ...from, worktreeTree: worktree },
		after: { ...to, worktreeTree: worktree },
		collisionChoices: [],
		extraPaths,
	});
	if (result.kind === 'done') {
		await noteNewOperation(ports, kind);
	}
	return result;
}

/**
 * Records a `check-changed-files` operation (spec 6.1) for the files of `plans` that still have
 * the content a hook wrote, so Undo can return them. Returns undefined when no file still has it.
 */
async function recordCheckEdits(ports: EnginePorts, plans: PathPlan[]): Promise<OperationResult | undefined> {
	const parts = await classifyPaths(ports, plans);
	const edited = plans.filter((_, index) => parts[index].part === 'after');
	if (edited.length === 0) {
		return undefined;
	}
	const branch = await currentBranch(ports);
	const indexTree = await readIndexTree(ports);
	if (branch === undefined || indexTree === undefined) {
		return UNUSUAL;
	}
	const state: Published = { branchCommit: await readBranch(ports, branch), indexTree };
	return publish(ports, 'check-changed-files', 'Changes made by the project check', state, state, edited);
}

/**
 * Splits the hook edits after a chunk stopped (`current`, measured from the snapshot taken
 * before the request) from those of the chunks that passed (`earlier`). `kept` are the earlier
 * edits that still have the content the earlier hooks wrote, which the published checkpoints
 * record. `added` are the other edits, measured from the content before the request.
 */
function splitEdits(earlier: PathPlan[], current: PathPlan[]): { kept: PathPlan[]; added: PathPlan[] } {
	const now = new Map(current.map(plan => [plan.path, plan]));
	const kept = earlier.filter(plan => {
		const later = now.get(plan.path);
		return later !== undefined && later.after === plan.after && later.afterMode === plan.afterMode;
	});
	const keptPaths = new Set(kept.map(plan => plan.path));
	return { kept, added: current.filter(plan => !keptPaths.has(plan.path)) };
}

function describeCreate(chunks: Chunk[]): string {
	return chunks.length === 1 ? `Create checkpoint "${chunks[0].title}"` : `Create ${chunks.length} checkpoints`;
}

// --- Creating --------------------------------------------------------------------------------

/**
 * Creates one checkpoint for each chunk, in order (spec 6.1). Nothing changes when `basis` is not
 * the basis of the changes now (`changes-moved`), a title is empty, longer than `TITLE_LIMIT`, or
 * more than one line (`nothing-to-do bad-title`), the request or a chunk selects nothing
 * (`nothing-to-do empty`), or a chunk names an unknown hunk or file (`nothing-to-do` with the
 * `ChunkError` code).
 *
 * Every chunk's approved tree is built first, each on the one before. A new request then cancels
 * a pending approval, as `declineCheckedCheckpoint` does. Each chunk then becomes a candidate
 * commit whose parent is the candidate before it, with the hooks run once for it. When every
 * hook passes and leaves its tree unchanged, the whole chain is published by one operation (one
 * undo entry): the branch moves to the last candidate, the index takes its tree, and the working
 * files stay as they are, apart from the files hooks changed on disk, which the operation records.
 *
 * At the first chunk whose hook rejects it or changes its tree, the chunks before it are
 * published first (one operation), and the result names the chunk by `chunkIndex`:
 *
 * - rejected: `check-failed` with the hook output. When this chunk's hooks changed files on disk,
 *   a `check-changed-files` operation records them for Undo, and the result has its id.
 * - tree changed: the candidate is kept under `refs/positron-checkpoints/pending/<token>` and a
 *   `pending-approval` journal record, and the result is `check-changed-checkpoint`. Later chunks
 *   are not created.
 *
 * The files each checkpoint took only part of are saved with `savePartialFiles`.
 */
export async function createCheckpoints(ports: EnginePorts, basis: string, chunks: Chunk[]): Promise<OperationResult> {
	if (chunks.some(chunk => isBadTitle(chunk.title))) {
		return nothingToDo('bad-title');
	}
	if (chunks.length === 0 || chunks.some(chunk => chunk.hunkIds.length === 0 && chunk.wholeFiles.length === 0)) {
		return nothingToDo('empty');
	}
	const branch = await currentBranch(ports);
	if (branch === undefined) {
		return UNUSUAL;
	}
	const read = await readChangesDetailed(ports);
	if (read.changeSet.basis !== basis) {
		return { kind: 'changes-moved' };
	}
	const head = read.head ?? null;

	const trees: { tree: string; partialFiles: string[] }[] = [];
	let base = head === null ? await emptyTree(ports) : (await git(ports, ['rev-parse', `${head}^{tree}`])).trim();
	try {
		for (const chunk of chunks) {
			const built = await treeForChunk(ports, base, read.changeSet, chunk);
			if (built.tree === base) {
				return nothingToDo('empty');
			}
			trees.push(built);
			base = built.tree;
		}
	} catch (error) {
		if (error instanceof ChunkError) {
			return error.code === 'changes-moved' ? { kind: 'changes-moved' } : nothingToDo(error.code);
		}
		throw error;
	}

	for (const record of await pendingRecords(ports)) {
		const cancelled = await discardPending(ports, record);
		if (cancelled !== undefined && cancelled.kind !== 'done') {
			return cancelled;
		}
	}

	const start: Published = { branchCommit: head, indexTree: read.indexTree };
	let parent = head;
	let edits: PathPlan[] = [];
	for (let index = 0; index < chunks.length; index++) {
		const chunk = chunks[index];
		const result = await buildCandidate(ports, { parent, approvedTree: trees[index].tree, title: chunk.title, body: chunk.body, snapshotTree: read.worktree });
		if (result.candidate !== undefined) {
			await savePartialFiles(ports, result.candidate, trees[index].partialFiles);
		}
		if (result.outcome === 'ok' && result.candidate !== undefined && result.resultTree === result.approvedTree) {
			parent = result.candidate;
			edits = result.hookEdited;
			continue;
		}

		const { kept, added } = splitEdits(edits, result.hookEdited);
		let state = start;
		if (index > 0) {
			const passed: Published = { branchCommit: parent, indexTree: trees[index - 1].tree };
			const published = await publish(ports, 'create-checkpoints', describeCreate(chunks.slice(0, index)), start, passed, kept);
			if (published.kind !== 'done') {
				return published;
			}
			state = passed;
		}
		if (result.outcome === 'rejected' || result.candidate === undefined) {
			const recorded = added.length === 0 ? undefined : await recordCheckEdits(ports, added);
			return {
				kind: 'check-failed', output: result.output, hookEditedFiles: added.map(plan => plan.path), chunkIndex: index,
				...(recorded?.kind === 'done' ? { operationId: recorded.operationId } : {}),
			};
		}
		return holdForApproval(ports, branch, describeCreate([chunk]), state, result, result.candidate, added, index);
	}
	return publish(ports, 'create-checkpoints', describeCreate(chunks), start, { branchCommit: parent, indexTree: base }, edits);
}

// --- Pending approvals -----------------------------------------------------------------------

/** The `pending-approval` records, oldest first. */
async function pendingRecords(ports: EnginePorts): Promise<(JournalRecord & { pending: NonNullable<JournalRecord['pending']> })[]> {
	return (await readRecords(ports)).filter((record): record is JournalRecord & { pending: NonNullable<JournalRecord['pending']> } =>
		record.status === 'pending-approval' && record.pending !== undefined);
}

/**
 * Keeps a candidate that a hook changed (spec 6.1): the candidate goes under the pending ref, and
 * a `pending-approval` record holds the branch, the state the candidate was built from
 * (`before`, with the working files as they are now), the state accepting it gives (`after`),
 * and the files this chunk's hooks changed on disk (`paths`). The token is the record's id.
 */
async function holdForApproval(
	ports: EnginePorts, branch: string, description: string, state: Published, result: CandidateResult, candidate: string, edits: PathPlan[], chunkIndex: number,
): Promise<OperationResult> {
	const token = ports.newId();
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	try {
		const worktree = (await worktreeTree(ports)).tree;
		// The all-zero old value makes git refuse to replace an existing ref.
		await git(ports, ['update-ref', `${PENDING_REF_PREFIX}${token}`, candidate, '0'.repeat(candidate.length)]);
		await writeRecord(ports, {
			id: token, kind: 'create-checkpoints', description, time: ports.now().toISOString(), branch,
			before: { ...state, worktreeTree: worktree },
			after: { branchCommit: candidate, indexTree: result.resultTree, worktreeTree: worktree },
			paths: edits, skipped: [], keptMoves: [], progress: [], status: 'pending-approval',
			pending: { token, approvedTree: result.approvedTree, resultTree: result.resultTree, candidate },
		});
	} finally {
		await lock.release().catch(() => undefined);
	}
	return {
		kind: 'check-changed-checkpoint', token, changedPaths: await treeDifference(ports, result.approvedTree, result.resultTree),
		hookEditedFiles: edits.map(plan => plan.path), chunkIndex,
	};
}

/** The approved tree and the tree the hooks left, of the pending approval `token`. */
export async function readPendingTrees(ports: EnginePorts, token: string): Promise<{ approvedTree: string; resultTree: string } | undefined> {
	const record = (await pendingRecords(ports)).find(candidate => candidate.pending.token === token);
	return record === undefined ? undefined : { approvedTree: record.pending.approvedTree, resultTree: record.pending.resultTree };
}

/** The newest pending approval, as `getState()` reports it, read from the journal. */
export async function readPendingApproval(ports: EnginePorts): Promise<EngineState['pendingApproval']> {
	const record = (await pendingRecords(ports)).pop();
	if (record === undefined) {
		return undefined;
	}
	return {
		token: record.pending.token,
		changedPaths: await treeDifference(ports, record.pending.approvedTree, record.pending.resultTree),
		hookEditedFiles: record.paths.map(plan => plan.path),
	};
}

/**
 * Closes a pending record: it is marked `abandoned` (the record never ran, so it never enters
 * the undo list) and its ref is removed. Returns false, and changes nothing, while another window
 * holds the lock.
 */
async function closePending(ports: EnginePorts, record: JournalRecord & { pending: NonNullable<JournalRecord['pending']> }): Promise<boolean> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return false;
	}
	try {
		await setStatus(ports, record.id, 'abandoned');
		await runGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', `${PENDING_REF_PREFIX}${record.pending.token}`]);
		return true;
	} finally {
		await lock.release().catch(() => undefined);
	}
}

/**
 * Closes a pending record without publishing it, then records the files its hooks changed on
 * disk as a `check-changed-files` operation. Returns the result of that operation, undefined
 * when there was nothing to record, and `unavailable busy` when the record could not be closed.
 */
async function discardPending(ports: EnginePorts, record: JournalRecord & { pending: NonNullable<JournalRecord['pending']> }): Promise<OperationResult | undefined> {
	if (!await closePending(ports, record)) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	return record.paths.length === 0 ? undefined : recordCheckEdits(ports, record.paths);
}

/**
 * Publishes the candidate of a pending approval without running the hooks again. It is
 * published only while the branch, its commit, the index, and the working files are those the
 * candidate was built from; otherwise the candidate is removed (with the hook edits recorded as
 * `declineCheckedCheckpoint` does) and the result is `project-changed`. An unknown token gives
 * `unavailable stale-operation-id`.
 */
export async function acceptCheckedCheckpoint(ports: EnginePorts, token: string): Promise<OperationResult> {
	const record = (await pendingRecords(ports)).find(candidate => candidate.pending.token === token);
	if (record === undefined) {
		return { kind: 'unavailable', reason: 'stale-operation-id' };
	}
	const branch = await currentBranch(ports);
	const branchCommit = branch === undefined ? undefined : await readBranch(ports, branch);
	if (branch === record.branch && branchCommit === record.after.branchCommit) {
		// The candidate was published, and the process stopped before the record was closed.
		const published = (await readRecords(ports)).filter(other => other.status === 'complete' && other.kind === 'create-checkpoints' && other.after.branchCommit === branchCommit).pop();
		await closePending(ports, record);
		return published === undefined ? { kind: 'project-changed' } : { kind: 'done', operationId: published.id, hookEditedFiles: record.paths.map(plan => plan.path) };
	}
	const indexTree = await readIndexTree(ports);
	const worktree = (await worktreeTree(ports)).tree;
	if (branch !== record.branch || branchCommit !== record.before.branchCommit || indexTree !== record.before.indexTree || worktree !== record.before.worktreeTree) {
		await discardPending(ports, record);
		return { kind: 'project-changed' };
	}
	const result = await runOperation(ports, {
		kind: 'create-checkpoints', description: record.description, expected: record.before, after: record.after, collisionChoices: [], extraPaths: record.paths,
	});
	if (result.kind === 'changes-moved') {
		await discardPending(ports, record);
		return { kind: 'project-changed' };
	}
	if (result.kind === 'done') {
		await noteNewOperation(ports, 'create-checkpoints');
		await closePending(ports, record);
	}
	return result;
}

/**
 * Declines a pending approval: the candidate's ref is removed and the record closed. Files its
 * hooks changed on disk that still have the content the hook wrote are recorded as a
 * `check-changed-files` operation, and `done` has that operation's id; with nothing to record,
 * `done` has the token. An unknown token gives `unavailable stale-operation-id`.
 */
export async function declineCheckedCheckpoint(ports: EnginePorts, token: string): Promise<OperationResult> {
	const record = (await pendingRecords(ports)).find(candidate => candidate.pending.token === token);
	if (record === undefined) {
		return { kind: 'unavailable', reason: 'stale-operation-id' };
	}
	return await discardPending(ports, record) ?? { kind: 'done', operationId: token, hookEditedFiles: [] };
}

// --- Rewording -------------------------------------------------------------------------------

interface CommitObject { tree: string; parents: string[]; author: { name: string; email: string; date: string }; encoding?: string; message: Buffer }

/** Reads a commit object exactly as git stores it. The author date keeps its time zone. */
async function readCommit(ports: EnginePorts, commit: string): Promise<CommitObject> {
	const raw = Buffer.from(await git(ports, ['cat-file', 'commit', commit], { binary: true }), 'latin1');
	const split = raw.indexOf('\n\n');
	const headerEnd = split === -1 ? raw.length : split;
	const object: CommitObject = { tree: '', parents: [], author: { name: '', email: '', date: '' }, message: split === -1 ? Buffer.alloc(0) : raw.subarray(split + 2) };
	for (const line of raw.subarray(0, headerEnd).toString('utf8').split('\n')) {
		const [key, ...rest] = line.split(' ');
		const value = rest.join(' ');
		if (key === 'tree') {
			object.tree = value;
		} else if (key === 'parent') {
			object.parents.push(value);
		} else if (key === 'encoding') {
			object.encoding = value;
		} else if (key === 'author') {
			const match = /^(?<name>.*) <(?<email>.*)> (?<seconds>-?\d+) (?<zone>[+-]\d{4})$/.exec(value);
			if (match?.groups === undefined) {
				throw new Error(`unreadable author of ${commit}`);
			}
			object.author = { name: match.groups.name, email: match.groups.email, date: `@${match.groups.seconds} ${match.groups.zone}` };
		}
	}
	return object;
}

/** The commit `id` names, when `id` is an object id of a commit. */
export async function resolveCommit(ports: EnginePorts, id: string): Promise<string | undefined> {
	if (!OBJECT_ID.test(id)) {
		return undefined;
	}
	const result = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', `${id}^{commit}`]);
	return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

/** True when `commit` is in the upstream of `branch` as git last saw it. A branch with no upstream has nothing shared. */
export async function isSharedCommit(ports: EnginePorts, branch: string, commit: string): Promise<boolean> {
	// `<branch>@{upstream}` needs the short name; the full ref name is not resolved.
	const upstream = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', `${branch}@{upstream}`]);
	if (upstream.exitCode !== 0) {
		return false;
	}
	const args = ['-C', ports.projectRoot, 'merge-base', '--is-ancestor', commit, upstream.stdout.trim()];
	const result = await runGit(ports.git, args);
	if (result.exitCode > 1) {
		throw new GitFailedError(args, result.exitCode, result.stderr);
	}
	return result.exitCode === 0;
}

/**
 * Gives the checkpoint `id` a new title and body. `id` must be on the first-parent history of
 * the current branch (otherwise `nothing-to-do not-in-history`) and not in the shared copy
 * (otherwise `shared-checkpoint`). The checkpoint and every later one on that history are made
 * again with `git commit-tree`: the same tree, other parents, author, author date, and message;
 * the first parent is the commit made just before it. The committer is the current person, at
 * the current time, and the commits are signed when `commit.gpgsign` is set, as for new
 * checkpoints. The branch then moves through `runOperation`; the index and working files do not
 * change. A title that fails the rules of `createCheckpoints` gives `nothing-to-do bad-title`,
 * and a message equal to the current one gives `nothing-to-do unchanged`.
 */
export async function editDescription(ports: EnginePorts, id: string, title: string, body: string): Promise<OperationResult> {
	if (isBadTitle(title)) {
		return nothingToDo('bad-title');
	}
	const branch = await currentBranch(ports);
	const indexTree = await readIndexTree(ports);
	if (branch === undefined || indexTree === undefined) {
		return UNUSUAL;
	}
	const head = await readBranch(ports, branch);
	const target = await resolveCommit(ports, id);
	if (head === null || target === undefined) {
		return nothingToDo('not-in-history');
	}
	const history = (await git(ports, ['rev-list', '--first-parent', head])).split('\n').filter(line => line !== '');
	const position = history.indexOf(target);
	if (position === -1) {
		return nothingToDo('not-in-history');
	}
	if (await isSharedCommit(ports, branch, target)) {
		return { kind: 'unavailable', reason: 'shared-checkpoint' };
	}
	const message = Buffer.from(await git(ports, ['stripspace'], { stdin: composeMessage(title, body) }), 'utf8');
	const original = await readCommit(ports, target);
	if (Buffer.compare(message, original.message) === 0) {
		return nothingToDo('unchanged');
	}

	const sign = await signArgs(ports);
	const date = ports.now().toISOString();
	const partial = await readPartialFiles(ports);
	let previous: string | undefined;
	for (const commit of history.slice(0, position + 1).reverse()) {
		const object = commit === target ? original : await readCommit(ports, commit);
		const parents = previous === undefined ? object.parents : [previous, ...object.parents.slice(1)];
		const made = await runGit(ports.git, [
			'-C', ports.projectRoot, ...(object.encoding === undefined ? [] : ['-c', `i18n.commitEncoding=${object.encoding}`]),
			'commit-tree', object.tree, ...parents.flatMap(parentId => ['-p', parentId]), ...sign,
		], {
			stdin: commit === target ? message : object.message,
			env: { GIT_AUTHOR_NAME: object.author.name, GIT_AUTHOR_EMAIL: object.author.email, GIT_AUTHOR_DATE: object.author.date, GIT_COMMITTER_DATE: date },
			timeoutMs: HOOK_TIMEOUT_MS,
		});
		if (made.exitCode !== 0) {
			return { kind: 'could-not-finish', detail: made.stderr.trim() };
		}
		previous = made.stdout.trim();
		await savePartialFiles(ports, previous, partial.get(commit) ?? []);
	}
	const oldTitle = original.message.toString('utf8').split('\n')[0];
	return publish(ports, 'edit-description', `Edit description of "${oldTitle}"`, { branchCommit: head, indexTree }, { branchCommit: previous!, indexTree }, []);
}

// --- Reversing -------------------------------------------------------------------------------

/** A commit that exists only in the object database, as an input to `git merge-tree`. */
async function temporaryCommit(ports: EnginePorts, tree: string, parents: string[]): Promise<string> {
	const date = ports.now().toISOString();
	return (await git(ports, ['commit-tree', '--no-gpg-sign', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'Positron Checkpoints input'], {
		env: { ...TEMPORARY_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
	})).trim();
}

/**
 * Runs `git merge-tree --write-tree -z --merge-base=<base> <ours> <theirs>` in the object
 * database. Returns the result tree and an overlap for each conflicted path (`ours` is "mine").
 */
async function mergeTrees(ports: EnginePorts, base: string, ours: string, theirs: string): Promise<{ tree: string; overlaps: Overlap[] }> {
	const args = ['-C', ports.projectRoot, 'merge-tree', '--write-tree', '-z', `--merge-base=${base}`, ours, theirs];
	const result = await runGit(ports.git, args, { timeoutMs: HOOK_TIMEOUT_MS });
	if (result.exitCode !== 0 && result.exitCode !== 1) {
		throw new GitFailedError(args, result.exitCode, result.stderr);
	}
	const fields = result.stdout.split('\0');
	const tree = fields[0].trim();
	if (result.exitCode === 0) {
		return { tree, overlaps: [] };
	}
	// Conflicted entries ("<mode> <oid> <stage>\t<path>"), an empty field, then messages
	// ("<count>", that many paths, the conflict type, the message).
	const stages = new Map<string, Map<number, { mode: string; oid: string }>>();
	let index = 1;
	for (; index < fields.length && fields[index] !== ''; index++) {
		const match = /^(?<mode>\d+) (?<oid>\w+) (?<stage>\d)\t(?<path>[\s\S]*)$/.exec(fields[index]);
		if (match?.groups !== undefined) {
			const entry = stages.get(match.groups.path) ?? new Map();
			entry.set(Number(match.groups.stage), { mode: match.groups.mode, oid: match.groups.oid });
			stages.set(match.groups.path, entry);
		}
	}
	const messages = new Map<string, string[]>();
	for (index++; index < fields.length && fields[index] !== '';) {
		const count = Number(fields[index++]);
		const paths = fields.slice(index, index + count);
		index += count;
		const text = `${fields[index++]}: ${fields[index++]}`;
		for (const file of paths) {
			messages.set(file, [...(messages.get(file) ?? []), text]);
		}
	}
	const overlaps: Overlap[] = [];
	for (const [file, entry] of stages) {
		overlaps.push(await describeOverlap(ports, file, entry, (messages.get(file) ?? []).join('\n')));
	}
	return { tree, overlaps };
}

/** The overlap at one conflicted path, from its stages: 1 is the base, 2 is mine, 3 is theirs. */
async function describeOverlap(ports: EnginePorts, file: string, entry: Map<number, { mode: string; oid: string }>, detail: string): Promise<Overlap> {
	const [base, mine, theirs] = [entry.get(1), entry.get(2), entry.get(3)];
	const regular = [base, mine, theirs].every(side => side === undefined || side.mode === '100644' || side.mode === '100755');
	const content = async (side: { oid: string } | undefined) => side === undefined ? undefined : Buffer.from(await git(ports, ['cat-file', 'blob', side.oid], { binary: true }), 'latin1');
	let kind: OverlapKind = 'unsupported';
	const overlap: Partial<Overlap> = {};
	if (regular && mine !== undefined && theirs !== undefined) {
		const sides = [await content(base), await content(mine), await content(theirs)];
		const binary = sides.some(side => side !== undefined && side.subarray(0, BINARY_PROBE_BYTES).includes(0));
		kind = binary ? 'binary' : 'text';
		if (binary) {
			overlap.mineSizeBytes = sides[1]!.length;
			overlap.theirsSizeBytes = sides[2]!.length;
		} else {
			overlap.base = sides[0]?.toString('utf8') ?? '';
			overlap.mine = sides[1]!.toString('utf8');
			overlap.theirs = sides[2]!.toString('utf8');
		}
	} else if (regular && base !== undefined && (mine === undefined) !== (theirs === undefined)) {
		kind = 'edit-delete';
		overlap.deletedBy = mine === undefined ? 'me' : 'them';
	}
	const id = createHash('sha256').update(`${kind}\0${file}\0${base?.oid ?? ''}\0${mine?.oid ?? ''}\0${theirs?.oid ?? ''}`).digest('hex').slice(0, 16);
	return { ...overlap, id, kind, path: file, otherPaths: [], theirAuthor: '', detail };
}

/**
 * Creates one checkpoint with the opposite change of checkpoint `id`, titled `Reversed: <title>`
 * (spec 6.3). `id` must be in the history of the current branch (otherwise `nothing-to-do
 * not-in-history`). The opposite change comes from `git merge-tree --write-tree
 * --merge-base=<id> HEAD <id>^` (the empty tree stands in for the parent of a first checkpoint),
 * and is applied the same way to the working files, so unrecorded edits stay. When either merge
 * overlaps, nothing changes and the result is `overlaps` with a preview that has no incoming
 * checkpoints. A reversal that changes nothing gives `nothing-to-do empty`. Hooks do not run, and
 * the commit is signed when `commit.gpgsign` is set. The branch, the index (the new tree), and
 * the working files change through `runOperation`, so a path collision returns
 * `path-collisions`.
 */
export async function reverseCheckpoint(ports: EnginePorts, id: string): Promise<OperationResult> {
	const branch = await currentBranch(ports);
	const indexTree = await readIndexTree(ports);
	if (branch === undefined || indexTree === undefined) {
		return UNUSUAL;
	}
	const head = await readBranch(ports, branch);
	const target = await resolveCommit(ports, id);
	if (head === null || target === undefined
		|| (await runGit(ports.git, ['-C', ports.projectRoot, 'merge-base', '--is-ancestor', target, head])).exitCode !== 0) {
		return nothingToDo('not-in-history');
	}
	const object = await readCommit(ports, target);
	const title = object.message.toString('utf8').split('\n')[0];
	const parent = object.parents[0] ?? await temporaryCommit(ports, await emptyTree(ports), []);
	const headTree = (await git(ports, ['rev-parse', `${head}^{tree}`])).trim();
	const worktree = (await worktreeTree(ports)).tree;

	const committed = await mergeTrees(ports, target, head, parent);
	const working = worktree === headTree ? committed : await mergeTrees(ports, target, await temporaryCommit(ports, worktree, [head]), parent);
	const overlaps = [...committed.overlaps, ...working.overlaps.filter(overlap => !committed.overlaps.some(other => other.id === overlap.id))];
	if (overlaps.length > 0) {
		const changedPaths = await treeDifference(ports, parent, target);
		const local = new Set(await treeDifference(ports, headTree, worktree));
		return {
			kind: 'overlaps',
			preview: { basis: '', incoming: [], changedPaths, touchesLocalWork: changedPaths.some(file => local.has(file)), overlaps, collisions: [] },
		};
	}
	if (committed.tree === headTree) {
		return nothingToDo('empty');
	}

	const date = ports.now().toISOString();
	const made = await runGit(ports.git, ['-C', ports.projectRoot, 'commit-tree', committed.tree, '-p', head, ...await signArgs(ports)], {
		stdin: `Reversed: ${title}\n`,
		env: { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		timeoutMs: HOOK_TIMEOUT_MS,
	});
	if (made.exitCode !== 0) {
		return { kind: 'could-not-finish', detail: made.stderr.trim() };
	}
	const expected: TriState = { branchCommit: head, indexTree, worktreeTree: worktree };
	const result = await runOperation(ports, {
		kind: 'reverse-checkpoint', description: `Reverse "${title}"`, expected,
		after: { branchCommit: made.stdout.trim(), indexTree: committed.tree, worktreeTree: working.tree },
		collisionChoices: [],
	});
	if (result.kind === 'done') {
		await noteNewOperation(ports, 'reverse-checkpoint');
	}
	return result;
}
