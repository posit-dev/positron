/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mustGit, runGit, splitZ } from './git';
import { acquireLock, engineDirectory, JournalRecord, OperationRole, PathPlan, readBranch, readIndexTree, readRecords, TriState } from './journal';
import { EnginePorts } from './ports';
import { CreatedFile, runOperation } from './runOperation';
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
	/** The ids a pending clear names (see `noteNewOperation`): out of both lists, and expired by the next `updateExpired`. */
	pending: Set<string>;
}

function last<T>(items: T[]): T | undefined {
	return items[items.length - 1];
}

async function stateFile(ports: EnginePorts): Promise<string> {
	return `${await engineDirectory(ports)}/operations-state.json`;
}

/** The file that names entries to expire once the lock is free: a JSON array of ids. */
async function pendingFile(ports: EnginePorts): Promise<string> {
	return `${await engineDirectory(ports)}/operations-pending.json`;
}

/** The ids of `operations-pending.json`, and its content as read. A missing or unreadable file names none. */
async function readPending(ports: EnginePorts): Promise<{ ids: string[]; content?: Uint8Array }> {
	const content = await ports.files.read(await pendingFile(ports));
	if (content === undefined) {
		return { ids: [] };
	}
	try {
		const parsed: unknown = JSON.parse(Buffer.from(content).toString('utf8'));
		return { ids: Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [], content };
	} catch {
		return { ids: [], content };
	}
}

/**
 * Reads `operations-state.json`. A missing or unreadable file lists nothing as expired; an entry
 * whose snapshot was removed is still left out of the lists (see `readLists`).
 */
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
 * - `send-changes` and `start-tracking` clear both lists, and so does an operation that gives
 *   the branch its first checkpoint, because its undo would leave the project with none (a
 *   `start-tracking` record follows such an operation, and this rule covers a stop between them);
 * - any other operation clears the redo list and becomes the head of the undo list.
 *
 * Entries listed as expired or pending, and entries whose snapshot ref is missing, are then
 * left out of both lists. An entry on the undo list whose undo restores the snapshot of its
 * latest Redo is also left out when that Redo's snapshot ref is missing.
 */
async function readLists(ports: EnginePorts): Promise<Lists> {
	const records = await readRecords(ports);
	const expired = new Set((await readState(ports)).expired);
	const pending = new Set((await readPending(ports)).ids);
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
		if (CLEARS_BOTH_LISTS.has(record.kind) || (record.before.branchCommit === null && record.after.branchCommit !== null)) {
			undo = [];
		} else {
			undo.push(record.id);
		}
	}
	// An entry whose snapshot is gone cannot be restored, whatever `operations-state.json` says
	// (the file may be unreadable). On the redo list, the snapshot of its Undo is needed too.
	const snapshots = await snapshotRefs(ports);
	const hasSnapshot = (id: string | undefined) => id !== undefined && snapshots.has(`${SNAPSHOT_REF_PREFIX}${id}`);
	const live = (id: string) => !expired.has(id) && !pending.has(id) && hasSnapshot(id);
	const redoneSnapshot = (id: string) => {
		const record = entries.find(entry => entry.id === id);
		const redone = latestRole(records, id, 'redo');
		return record === undefined || !RESTORES_SNAPSHOT.has(record.kind) || redone === undefined || hasSnapshot(redone.id);
	};
	return {
		records,
		entries,
		undo: undo.filter(id => live(id) && redoneSnapshot(id)),
		redo: redo.filter(id => live(id) && hasSnapshot(latestRole(records, id, 'undo')?.id)),
		expired,
		pending,
	};
}

/** The names of every snapshot ref. */
async function snapshotRefs(ports: EnginePorts): Promise<Set<string>> {
	const output = (await mustGit(ports.git, ['-C', ports.projectRoot, 'for-each-ref', '--format=%(refname)', SNAPSHOT_REF_PREFIX])).stdout;
	return new Set(output.split('\n').filter(line => line !== ''));
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
	const undoRecord = latestRole(lists.records, record.id, 'undo');
	return undoRecord === undefined ? record : { ...record, redoWorktreeTree: undoRecord.before.worktreeTree };
}

/** The latest completed Undo or Redo (`kind`) of `target`. */
function latestRole(records: JournalRecord[], target: string, kind: OperationRole['kind']): JournalRecord | undefined {
	return last(records.filter(record => record.status === 'complete' && record.role?.kind === kind && record.role.target === target));
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
 * - `get-changes`, `go-back`: the branch returns to its before commit, and the index and the
 *   working files to the operation's snapshot, under the restore and collision rules of 6.2.
 *   After a Redo of the entry, they return instead to the latest Redo's own snapshot, so edits
 *   made between an Undo and the Redo that followed it return too. A file that the restored
 *   operation (or Redo) created is removed when the snapshot lacks it, even when HEAD does not
 *   track it, while it still has the bytes the engine wrote (compared with no filters); one changed since stays.
 * - every other kind (`create-checkpoints`, `reverse-checkpoint`, `edit-description`,
 *   `check-changed-files`): the branch returns to its before commit; the index returns to its
 *   before tree only while it is still at the operation's after tree; each file the operation
 *   recorded (a file a project check rewrote) returns to its before content only while it
 *   still has the content the check wrote. Other working files are left as they are.
 *
 * Files the operation (or, after a Redo, that Redo) kept aside move back where nothing else is
 * at their place, once the Undo is complete and before the lock is released.
 *
 * Returns `unavailable stale-operation-id` when `operationId` is not the head,
 * `project-changed` when the branch is not at the operation's after commit, and `unavailable
 * shared-checkpoint` when the operation created checkpoints that are in the shared copy.
 * Otherwise returns the result of `runOperation`; an Undo that does not finish leaves the lists
 * as they were.
 */
export async function undo(ports: EnginePorts, operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	const lists = await readLists(ports);
	const record = lists.entries.find(entry => entry.id === last(lists.undo));
	if (record === undefined || record.id !== operationId) {
		return { kind: 'unavailable', reason: 'stale-operation-id' };
	}
	// After a Redo, the project as it was just before that Redo is what this Undo returns to.
	const redone = latestRole(lists.records, record.id, 'redo');
	const restored = redone ?? record;
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
		? { branchCommit: record.before.branchCommit, indexTree: restored.before.indexTree, worktreeTree: restored.before.worktreeTree }
		: {
			branchCommit: record.before.branchCommit,
			indexTree: state.indexTree === record.after.indexTree ? record.before.indexTree : state.indexTree,
			worktreeTree: await flipPaths(ports, state.worktreeTree, record.paths, 'undo'),
		};
	return runOperation(ports, {
		kind: record.kind, description: `Undo: ${record.description}`, expected: state, after, collisionChoices,
		role: { kind: 'undo', target: record.id },
		returnKept: { operationId: restored.id, moves: restored.keptMoves },
		// The files the restored operation created are not in its snapshot, and it may remove them.
		...(RESTORES_SNAPSHOT.has(record.kind) ? { removableCreated: createdFiles(restored) } : {}),
	});
}

/** The files `record` created, each with the id of the raw bytes it wrote (its `written` entry). */
function createdFiles(record: JournalRecord): CreatedFile[] {
	return record.paths.filter(plan => plan.before === null).map(plan => {
		const written = record.progress.find(entry => entry.step === 'written' && entry.path === plan.path);
		return written?.step === 'written' ? { ...plan, raw: written.raw } : plan;
	});
}

/**
 * Applies the head of the redo list again (spec 6.3) through `runOperation`. The branch moves
 * to the operation's after commit. For `get-changes` and `go-back`, the index and the working
 * files return to the redo snapshot, so edits made between the operation and its Undo return.
 * For every other kind, the index returns to the operation's after tree only when the Undo moved
 * it from that tree and it is still at the tree the Undo left, and each recorded file returns to
 * the content the check wrote only while it still has the content the Undo restored. The Redo's own snapshot is kept with the
 * entry.
 *
 * Returns `unavailable stale-operation-id` when `operationId` is not the head, and
 * `project-changed` when the branch is not at the operation's before commit. Otherwise returns
 * the result of `runOperation`; a Redo that does not finish leaves the lists as they were.
 */
export async function redo(ports: EnginePorts, operationId: string, collisionChoices: CollisionChoice[]): Promise<OperationResult> {
	const lists = await readLists(ports);
	const record = lists.entries.find(entry => entry.id === last(lists.redo));
	const undoRecord = record === undefined ? undefined : latestRole(lists.records, record.id, 'undo');
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
			// Only an index the Undo moved from the operation's tree, and that is still where the
			// Undo left it, returns; newer staged work that the Undo left in place stays.
			indexTree: undoRecord.before.indexTree === record.after.indexTree && state.indexTree === undoRecord.after.indexTree
				? record.after.indexTree
				: state.indexTree,
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
 * A path with any other value is left as it is, and so is a folder at a path whose from-side is
 * no file (a hook replaced a file with a folder): a file never replaces a folder's content.
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
		const matches = from === null ? entry === undefined : entry !== undefined && entry.type === 'blob' && entry.blob === from && entry.mode === fromMode;
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

/** The file and folder entries of `tree` at exactly the given paths. */
async function treeEntries(ports: EnginePorts, tree: string, paths: string[]): Promise<Map<string, { mode: string; type: string; blob: string }>> {
	const requested = new Set(paths);
	const found = new Map<string, { mode: string; type: string; blob: string }>();
	for (let start = 0; start < paths.length; start += 200) {
		const output = (await mustGit(ports.git, ['-C', ports.projectRoot, '--literal-pathspecs', 'ls-tree', '-z', tree, '--', ...paths.slice(start, start + 200)])).stdout;
		for (const line of splitZ(output)) {
			const match = /^(?<mode>\d+) (?<type>\w+) (?<blob>\w+)\t(?<file>[\s\S]*)$/.exec(line);
			if (match?.groups !== undefined && (match.groups.type === 'blob' || match.groups.type === 'tree') && requested.has(match.groups.file)) {
				found.set(match.groups.file, { mode: match.groups.mode, type: match.groups.type, blob: match.groups.blob });
			}
		}
	}
	return found;
}

/** How many more times `noteNewOperation` tries to take the lock, and how long it waits before each try. */
const LOCK_RETRIES = 10;
const LOCK_RETRY_MS = 100;

/**
 * Records that a new operation of `kind` finished (spec 6.3): the redo list is cleared, and
 * `send-changes` and `start-tracking` clear both lists. Cleared entries expire with their
 * snapshots. Call it after the operation completes. Kept files are never touched.
 *
 * While another window holds the lock, it waits and tries again. When the lock stays taken, the
 * entries to clear are added to `operations-pending.json`: they leave both lists at once, and the
 * next `expire` (after the next operation, or at engine start) expires them.
 */
export async function noteNewOperation(ports: EnginePorts, kind: OperationKind): Promise<void> {
	const choose = (lists: Lists) => CLEARS_BOTH_LISTS.has(kind) ? [...lists.undo, ...lists.redo] : [...lists.redo];
	for (let attempt = 0; attempt <= LOCK_RETRIES; attempt++) {
		if (attempt > 0) {
			await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_MS));
		}
		if (await updateExpired(ports, choose)) {
			return;
		}
	}
	const cleared = choose(await readLists(ports));
	if (cleared.length > 0) {
		const pending = await readPending(ports);
		await ports.files.write(await pendingFile(ports), Buffer.from(JSON.stringify([...new Set([...pending.ids, ...cleared])])), false);
	}
}

/**
 * Applies the retention rule of spec 6.2: entries on the undo list beyond the newest 50, or
 * older than 30 days, expire, and their snapshot refs are removed in the same call. Entries on
 * the redo list stay until a new operation clears it. Entries `operations-pending.json` names
 * expire too. Recovery refs, pending refs, and kept files are never touched.
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
 * Under the lock, marks as expired the entries `choose` returns, the entries
 * `operations-pending.json` names, and every entry that is on neither list (cleared by a later
 * operation), writes `operations-state.json`, removes `operations-pending.json` when it is
 * unchanged since it was read, and only then removes the snapshot refs of those entries and of
 * their Undo and Redo records. A record that is not complete or rolled back keeps its snapshot,
 * because recovery may need it. Returns false, and does nothing, while another window holds the
 * lock; the next call catches up.
 */
async function updateExpired(ports: EnginePorts, choose: (lists: Lists) => string[]): Promise<boolean> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return false;
	}
	try {
		const pending = await readPending(ports);
		const lists = await readLists(ports);
		// The lists leave out pending entries, so `live` never has them.
		const live = new Set([...lists.undo, ...lists.redo]);
		for (const id of choose(lists)) {
			live.delete(id);
		}
		const newlyExpired = lists.entries.filter(record => !live.has(record.id) && !lists.expired.has(record.id)).map(record => record.id);
		if (newlyExpired.length > 0) {
			const state: OperationsState = { expired: [...lists.expired, ...newlyExpired] };
			await ports.files.write(await stateFile(ports), Buffer.from(JSON.stringify(state)), false);
		}
		if (pending.content !== undefined) {
			const now = await ports.files.read(await pendingFile(ports));
			if (now !== undefined && Buffer.compare(Buffer.from(now), Buffer.from(pending.content)) === 0) {
				await ports.files.remove(await pendingFile(ports));
			}
		}
		if (newlyExpired.length === 0) {
			return true;
		}
		const expiring = new Set(newlyExpired);
		const owned = lists.records
			.filter(record => record.role !== undefined && expiring.has(record.role.target) && (record.status === 'complete' || record.status === 'rolled-back'))
			.map(record => record.id);
		for (const id of [...newlyExpired, ...owned]) {
			// A ref that is already gone is not an error.
			await runGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', `${SNAPSHOT_REF_PREFIX}${id}`]);
		}
		return true;
	} finally {
		await lock.release().catch(() => undefined);
	}
}
