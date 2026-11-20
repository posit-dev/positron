/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { moveBack } from './collisions';
import { mustGit, runGit, splitZ } from './git';
import { acquireLock, engineDirectory, JournalRecord, PathPlan, readBranch, readIndexTree, readRecords, TriState } from './journal';
import { EnginePorts } from './ports';
import { runOperation } from './runOperation';
import { SNAPSHOT_REF_PREFIX, withTempIndex, worktreeTree } from './trees';
import { CollisionChoice, OperationKind, OperationResult } from './types';

/** The undo list keeps at most this many operations (spec 6.2). */
export const UNDO_LIMIT = 50;

/** The undo list keeps operations for this long (spec 6.2). */
export const UNDO_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Kinds that clear both lists and are never undone (spec 6.3). */
const CLEARS_BOTH_LISTS = new Set<OperationKind>(['send-changes', 'start-tracking']);

/** Kinds whose undo makes the working files match the operation's snapshot (spec 6.3). */
const RESTORES_SNAPSHOT = new Set<OperationKind>(['get-changes', 'go-back']);

/** Kinds that create checkpoints, so their undo can rewrite history a colleague has. */
const CREATES_CHECKPOINTS = new Set<OperationKind>(['create-checkpoints', 'reverse-checkpoint', 'edit-description']);

/**
 * An entry of the operation log: a completed operation that is not itself an Undo or a Redo.
 * `undone` is true while the entry is on the redo list. `expired` is true once it is on neither
 * list, and its snapshots are then removed (or about to be removed).
 */
export interface LogEntry { record: JournalRecord; undone: boolean; expired: boolean }

/** The content of `operations-state.json`: the ids of expired entries. */
interface OperationsState { expired: string[] }

interface Lists {
	records: JournalRecord[];
	/** Every log entry, in journal order. */
	entries: JournalRecord[];
	/** The undo list, oldest first: its head is the last id. */
	undo: string[];
	/** The redo list, in the order the entries were undone: its head is the last id. */
	redo: string[];
	expired: Set<string>;
}

function last<T>(items: T[]): T | undefined {
	return items[items.length - 1];
}

async function stateFile(ports: EnginePorts): Promise<string> {
	return `${await engineDirectory(ports)}/operations-state.json`;
}

/** Reads `operations-state.json`. A missing or unreadable file means that nothing has expired. */
async function readState(ports: EnginePorts): Promise<OperationsState> {
	const content = await ports.files.read(await stateFile(ports));
	if (content === undefined) {
		return { expired: [] };
	}
	try {
		const parsed = JSON.parse(Buffer.from(content).toString('utf8')) as Partial<OperationsState>;
		return { expired: Array.isArray(parsed.expired) ? parsed.expired.filter((id): id is string => typeof id === 'string') : [] };
	} catch {
		return { expired: [] };
	}
}

/**
 * Builds the two lists from the journal and `operations-state.json`. The journal is replayed
 * in order, counting only complete records, so an Undo or a Redo that failed, was rolled back,
 * or was interrupted changes nothing:
 *
 * - a completed Undo moves its target from the head of the undo list to the redo list, and a
 *   completed Redo moves it back;
 * - `send-changes` and `start-tracking` clear both lists;
 * - any other operation clears the redo list and becomes the head of the undo list.
 *
 * Entries listed as expired are then left out of both lists.
 */
async function readLists(ports: EnginePorts): Promise<Lists> {
	const records = await readRecords(ports);
	const expired = new Set((await readState(ports)).expired);
	const entries: JournalRecord[] = [];
	let undo: string[] = [];
	let redo: string[] = [];
	for (const record of records) {
		if (record.status !== 'complete') {
			continue;
		}
		const role = record.role;
		if (role !== undefined) {
			const [from, to] = role.kind === 'undo' ? [undo, redo] : [redo, undo];
			if (last(from) === role.target) {
				from.pop();
				to.push(role.target);
			}
			continue;
		}
		entries.push(record);
		redo = [];
		if (CLEARS_BOTH_LISTS.has(record.kind)) {
			undo = [];
		} else {
			undo.push(record.id);
		}
	}
	return {
		records,
		entries,
		undo: undo.filter(id => !expired.has(id)),
		redo: redo.filter(id => !expired.has(id)),
		expired,
	};
}

/** Every log entry in journal order, with its place on the lists. */
export async function readOperationLog(ports: EnginePorts): Promise<LogEntry[]> {
	const lists = await readLists(ports);
	const undone = new Set(lists.redo);
	const live = new Set([...lists.undo, ...lists.redo]);
	return lists.entries.map(record => ({ record, undone: undone.has(record.id), expired: !live.has(record.id) }));
}

/** The newest entry on the undo list. */
export async function undoHead(ports: EnginePorts): Promise<JournalRecord | undefined> {
	const lists = await readLists(ports);
	return lists.entries.find(record => record.id === last(lists.undo));
}

/**
 * The entry most recently undone, with `redoWorktreeTree` set to the working-file tree of the
 * redo snapshot (the project as it was just before that Undo).
 */
export async function redoHead(ports: EnginePorts): Promise<JournalRecord | undefined> {
	const lists = await readLists(ports);
	const record = lists.entries.find(entry => entry.id === last(lists.redo));
	if (record === undefined) {
		return undefined;
	}
	const undoRecord = latestUndo(lists.records, record.id);
	return undoRecord === undefined ? record : { ...record, redoWorktreeTree: undoRecord.before.worktreeTree };
}

/** The latest completed Undo of `target`. */
function latestUndo(records: JournalRecord[], target: string): JournalRecord | undefined {
	return last(records.filter(record => record.status === 'complete' && record.role?.kind === 'undo' && record.role.target === target));
}

/** The branch HEAD points at and the three parts of the project now, or undefined when HEAD is detached or the index is unreadable. */
async function readProject(ports: EnginePorts): Promise<{ branch: string; state: TriState } | undefined> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const ref = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	if (!ref.startsWith('refs/heads/')) {
		return undefined;
	}
	const branch = ref.slice('refs/heads/'.length);
	const indexTree = await readIndexTree(ports);
	if (indexTree === undefined) {
		return undefined;
	}
	const branchCommit = await readBranch(ports, branch);
	return { branch, state: { branchCommit, indexTree, worktreeTree: (await worktreeTree(ports)).tree } };
}

/**
 * Undoes the head of the undo list (spec 6.3) through `runOperation`, so the journal, the
 * per-path checks, the collision check, and crash recovery all apply. The Undo's own snapshot
 * is the redo snapshot. What it restores depends on the kind:
 *
 * - `get-changes`, `go-back`: the branch, the index, and the working files return to the
 *   operation's before state (the snapshot), under the restore and collision rules of 6.2.
 *   Files the operation kept aside move back where nothing else is at their place.
 * - every other kind (`create-checkpoints`, `reverse-checkpoint`, `edit-description`,
 *   `check-changed-files`): the branch returns to its before commit; the index returns to its
 *   before tree only while it is still at the operation's after tree; each file the operation
 *   recorded (a file a project check rewrote) returns to its before content only while it
 *   still has the content the check wrote. Other working files are left as they are.
 *
 * Returns `unavailable stale-operation-id` when `operationId` is not the head,
 * `project-changed` when the branch is not at the operation's after commit, and `unavailable
 * shared-checkpoint` when the operation created checkpoints that are in the shared copy.
 * Otherwise returns the result of `runOperation`; an Undo that does not finish leaves the lists
 * as they were.
 */
export async function undo(ports: EnginePorts, operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	const record = await undoHead(ports);
	if (record === undefined || record.id !== operationId) {
		return { kind: 'unavailable', reason: 'stale-operation-id' };
	}
	const project = await readProject(ports);
	if (project === undefined) {
		return { kind: 'unavailable', reason: 'unusual-state' };
	}
	const { state } = project;
	if (project.branch !== record.branch || state.branchCommit !== record.after.branchCommit) {
		return { kind: 'project-changed' };
	}
	if (CREATES_CHECKPOINTS.has(record.kind) && await isShared(ports, record)) {
		return { kind: 'unavailable', reason: 'shared-checkpoint' };
	}
	const after: TriState = RESTORES_SNAPSHOT.has(record.kind)
		? { ...record.before }
		: {
			branchCommit: record.before.branchCommit,
			indexTree: state.indexTree === record.after.indexTree ? record.before.indexTree : state.indexTree,
			worktreeTree: await flipPaths(ports, state.worktreeTree, record.paths, 'undo'),
		};
	const result = await runOperation(ports, {
		kind: record.kind, description: `Undo: ${record.description}`, expected: state, after, collisionChoices,
		role: { kind: 'undo', target: record.id },
	});
	if (result.kind === 'done') {
		await returnKeptFiles(ports, record);
	}
	return result;
}

/**
 * Applies the head of the redo list again (spec 6.3) through `runOperation`. The branch moves
 * to the operation's after commit. For `get-changes` and `go-back`, the index and the working
 * files return to the redo snapshot, so edits made between the operation and its Undo return.
 * For every other kind, the index returns to the operation's after tree only while it is still
 * at the tree the Undo left, and each recorded file returns to the content the check wrote only
 * while it still has the content the Undo restored. The Redo's own snapshot is kept with the
 * entry.
 *
 * Returns `unavailable stale-operation-id` when `operationId` is not the head, and
 * `project-changed` when the branch is not at the operation's before commit. Otherwise returns
 * the result of `runOperation`; a Redo that does not finish leaves the lists as they were.
 */
export async function redo(ports: EnginePorts, operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	const lists = await readLists(ports);
	const record = lists.entries.find(entry => entry.id === last(lists.redo));
	const undoRecord = record === undefined ? undefined : latestUndo(lists.records, record.id);
	if (record === undefined || undoRecord === undefined || record.id !== operationId) {
		return { kind: 'unavailable', reason: 'stale-operation-id' };
	}
	const project = await readProject(ports);
	if (project === undefined) {
		return { kind: 'unavailable', reason: 'unusual-state' };
	}
	const { state } = project;
	if (project.branch !== record.branch || state.branchCommit !== record.before.branchCommit) {
		return { kind: 'project-changed' };
	}
	const after: TriState = RESTORES_SNAPSHOT.has(record.kind)
		? { branchCommit: record.after.branchCommit, indexTree: undoRecord.before.indexTree, worktreeTree: undoRecord.before.worktreeTree }
		: {
			branchCommit: record.after.branchCommit,
			indexTree: state.indexTree === undoRecord.after.indexTree ? record.after.indexTree : state.indexTree,
			worktreeTree: await flipPaths(ports, state.worktreeTree, record.paths, 'redo'),
		};
	return runOperation(ports, {
		kind: record.kind, description: `Redo: ${record.description}`, expected: state, after, collisionChoices,
		role: { kind: 'redo', target: record.id },
	});
}

/**
 * True when a checkpoint the operation created is in the upstream of its branch, as git last
 * saw it. A branch with no upstream has nothing shared.
 */
async function isShared(ports: EnginePorts, record: JournalRecord): Promise<boolean> {
	if (record.after.branchCommit === null) {
		return false;
	}
	// `<branch>@{upstream}` needs the short name; the full ref name is not resolved.
	const upstream = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', '--end-of-options', `${record.branch}@{upstream}`]);
	if (upstream.exitCode !== 0) {
		return false;
	}
	const range = [record.after.branchCommit, ...(record.before.branchCommit === null ? [] : [`^${record.before.branchCommit}`])];
	const count = async (args: string[]) => Number((await mustGit(ports.git, ['-C', ports.projectRoot, 'rev-list', '--count', ...args])).stdout.trim());
	return await count([...range, `^${upstream.stdout.trim()}`]) !== await count(range);
}

/**
 * The tree `base` with each path of `plans` changed from one side of its plan to the other:
 * for `undo`, a path that has its after value gets its before value; for `redo`, the reverse.
 * A path with any other value is left as it is.
 */
async function flipPaths(ports: EnginePorts, base: string, plans: PathPlan[], direction: 'undo' | 'redo'): Promise<string> {
	if (plans.length === 0) {
		return base;
	}
	const current = await treeEntries(ports, base, plans.map(plan => plan.path));
	const zero = '0'.repeat(base.length);
	const lines: string[] = [];
	for (const plan of plans) {
		const [fromMode, from, toMode, to] = direction === 'undo'
			? [plan.afterMode, plan.after, plan.beforeMode, plan.before]
			: [plan.beforeMode, plan.before, plan.afterMode, plan.after];
		const entry = current.get(plan.path);
		const matches = from === null ? entry === undefined : entry !== undefined && entry.blob === from && entry.mode === fromMode;
		if (!matches) {
			continue;
		}
		lines.push(to === null || toMode === null ? `0 ${zero}\t${plan.path}\0` : `${toMode} ${to}\t${plan.path}\0`);
	}
	if (lines.length === 0) {
		return base;
	}
	const git = (args: string[], options: Parameters<EnginePorts['git']>[1]) => mustGit(ports.git, ['-C', ports.projectRoot, ...args], options);
	return withTempIndex(ports, async env => {
		await git(['read-tree', base], { env });
		await git(['update-index', '-z', '--index-info'], { env, stdin: lines.join('') });
		return (await git(['write-tree'], { env })).stdout.trim();
	});
}

/** The file entries of `tree` at exactly the given paths. */
async function treeEntries(ports: EnginePorts, tree: string, paths: string[]): Promise<Map<string, { mode: string; blob: string }>> {
	const requested = new Set(paths);
	const found = new Map<string, { mode: string; blob: string }>();
	for (let start = 0; start < paths.length; start += 200) {
		const output = (await mustGit(ports.git, ['-C', ports.projectRoot, '--literal-pathspecs', 'ls-tree', '-z', tree, '--', ...paths.slice(start, start + 200)])).stdout;
		for (const line of splitZ(output)) {
			const match = /^(?<mode>\d+) (?<type>\w+) (?<blob>\w+)\t(?<file>[\s\S]*)$/.exec(line);
			if (match?.groups !== undefined && match.groups.type === 'blob' && requested.has(match.groups.file)) {
				found.set(match.groups.file, { mode: match.groups.mode, blob: match.groups.blob });
			}
		}
	}
	return found;
}

/**
 * Moves the files the operation kept aside back to their places, under the lock. A file whose
 * place is taken stays in the kept folder, listed for the person. When another window holds
 * the lock, the files stay listed in the kept folder.
 */
async function returnKeptFiles(ports: EnginePorts, record: JournalRecord): Promise<void> {
	if (record.keptMoves.length === 0) {
		return;
	}
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return;
	}
	try {
		for (const move of record.keptMoves) {
			await moveBack(ports, record.id, move);
		}
	} finally {
		await lock.release().catch(() => undefined);
	}
}

/**
 * Records that a new operation of `kind` finished (spec 6.3): the redo list is cleared, and
 * `send-changes` and `start-tracking` clear both lists. Cleared entries expire with their
 * snapshots. Call it after the operation completes. Kept files are never touched.
 */
export async function noteNewOperation(ports: EnginePorts, kind: OperationKind): Promise<void> {
	await updateExpired(ports, lists => CLEARS_BOTH_LISTS.has(kind) ? [...lists.undo, ...lists.redo] : [...lists.redo]);
}

/**
 * Applies the retention rule of spec 6.2: entries on the undo list beyond the newest 50, or
 * older than 30 days, expire, and their snapshot refs are removed in the same call. Entries on
 * the redo list stay until a new operation clears it. Recovery refs, pending refs, and kept
 * files are never touched.
 */
export async function expire(ports: EnginePorts): Promise<void> {
	const oldest = ports.now().getTime() - UNDO_AGE_MS;
	await updateExpired(ports, lists => {
		const beyondLimit = lists.undo.slice(0, Math.max(0, lists.undo.length - UNDO_LIMIT));
		const tooOld = lists.entries.filter(record => lists.undo.includes(record.id) && Date.parse(record.time) < oldest).map(record => record.id);
		return [...beyondLimit, ...tooOld];
	});
}

/**
 * Under the lock, marks as expired the entries `choose` returns and every entry that is on
 * neither list (cleared by a later operation), writes `operations-state.json`, and only then
 * removes the snapshot refs of those entries and of their Undo and Redo records. A record that
 * is not complete or rolled back keeps its snapshot, because recovery may need it. Does nothing
 * while another window holds the lock; the next call catches up.
 */
async function updateExpired(ports: EnginePorts, choose: (lists: Lists) => string[]): Promise<void> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return;
	}
	try {
		const lists = await readLists(ports);
		const live = new Set([...lists.undo, ...lists.redo]);
		for (const id of choose(lists)) {
			live.delete(id);
		}
		const newlyExpired = lists.entries.filter(record => !live.has(record.id) && !lists.expired.has(record.id)).map(record => record.id);
		if (newlyExpired.length === 0) {
			return;
		}
		const state: OperationsState = { expired: [...lists.expired, ...newlyExpired] };
		await ports.files.write(await stateFile(ports), Buffer.from(JSON.stringify(state)), false);
		const expiring = new Set(newlyExpired);
		const owned = lists.records
			.filter(record => record.role !== undefined && expiring.has(record.role.target) && (record.status === 'complete' || record.status === 'rolled-back'))
			.map(record => record.id);
		for (const id of [...newlyExpired, ...owned]) {
			// A ref that is already gone is not an error.
			await runGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', `${SNAPSHOT_REF_PREFIX}${id}`]);
		}
	} finally {
		await lock.release().catch(() => undefined);
	}
}
