/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { findCollisions } from './collisions';
import { GitFailedError, mustGit, runGit, splitZ } from './git';
import {
	acquireLock, appendProgress, classify, classifyPaths, FileMode, JournalRecord, Part, PathPlan,
	Progress, readBranch, readIndexTree, readRecords, setStatus, TriState, writeRecord,
} from './journal';
import { EnginePorts } from './ports';
import { RECOVERY_REF_PREFIX, saveSnapshot, SNAPSHOT_REF_PREFIX, STAGING_TIMEOUT_MS } from './trees';
import { CollisionChoice, OperationKind, OperationResult } from './types';

export interface OperationPlan {
	kind: OperationKind; description: string;
	/** The state the caller computed `after` from. The operation runs only while the project is still in it. */
	expected: TriState;
	/** Computed by the caller in the object database. */
	after: TriState;
	collisionChoices: CollisionChoice[];
	/**
	 * Files a hook already changed on disk: `before` is their earlier content and `after` is what
	 * is on disk now. The engine never writes them, so a failed operation leaves them as they are.
	 */
	extraPaths?: PathPlan[];
}

/** A step found a part that is no longer at the value the record expects. */
class StepRefused extends Error { }

/**
 * Runs an operation through the protocol of spec 6.3.1: take the lock, refuse while an earlier
 * operation is unresolved, record the before state with a snapshot, return `changes-moved` when
 * it differs from `plan.expected`, derive the paths to write, run the collision check, journal
 * the record, then change the working files (each only while it still has its before content),
 * the index (only while it still has its before tree), and last the branch (a compare-and-swap),
 * and mark the record complete. A durable progress entry is appended before each change, so the
 * journal lists every part the engine may have changed, even after a crash.
 *
 * A run that ends before its record exists removes its snapshot. On any later failure it runs
 * `reverse(record, 'all-or-report')`: a clean reversal returns `could-not-finish` with status
 * `rolled-back`; content changed by another tool after the engine wrote it returns
 * `interrupted` with status `interrupted` and a recovery snapshot. When the reversal itself
 * fails, the record is marked `interrupted` (as far as the journal can still be written) and
 * the result is `interrupted`.
 */
export async function runOperation(ports: EnginePorts, plan: OperationPlan): Promise<OperationResult> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	try {
		if ((await readRecords(ports)).some(record => record.status === 'prepared' || record.status === 'interrupted')) {
			return { kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' };
		}
		return await runLocked(ports, plan);
	} finally {
		// The outcome is decided; a lock that cannot be removed now is taken over once it is stale.
		await lock.release().catch(() => undefined);
	}
}

async function runLocked(ports: EnginePorts, plan: OperationPlan): Promise<OperationResult> {
	const symbolic = await runGit(ports.git, ['-C', ports.projectRoot, 'symbolic-ref', '-q', 'HEAD']);
	const headRef = symbolic.exitCode === 0 ? symbolic.stdout.trim() : '';
	if (!headRef.startsWith('refs/heads/')) {
		return { kind: 'unavailable', reason: 'unusual-state', detail: 'HEAD does not point at a branch' };
	}
	const branch = headRef.slice('refs/heads/'.length);
	const id = ports.newId();
	const extraPaths = plan.extraPaths ?? [];

	let record: JournalRecord;
	try {
		const branchCommit = await readBranch(ports, branch);
		const snapshot = await saveSnapshot(ports, id, branchCommit ?? undefined);
		const before: TriState = { branchCommit, indexTree: snapshot.indexTree, worktreeTree: snapshot.worktreeTree };
		if (before.branchCommit !== plan.expected.branchCommit || before.indexTree !== plan.expected.indexTree || before.worktreeTree !== plan.expected.worktreeTree) {
			await removeSnapshot(ports, id);
			return { kind: 'changes-moved' };
		}
		const paths = await planPaths(ports, before, plan.after, extraPaths);
		const collisions = await findCollisions(ports, paths, snapshot.skipped);
		const unanswered = collisions.filter(collision => !plan.collisionChoices.some(choice => choice.path === collision.path));
		if (unanswered.length > 0) {
			await removeSnapshot(ports, id);
			return { kind: 'path-collisions', collisions: unanswered };
		}
		record = {
			id, kind: plan.kind, description: plan.description, time: ports.now().toISOString(), branch,
			before, after: plan.after, paths, skipped: snapshot.skipped,
			keptMoves: [], progress: [], status: 'prepared',
		};
		await writeRecord(ports, record);
	} catch (error) {
		// Nothing visible has changed yet. A record whose write reported an error may still have
		// reached the journal; it has no progress entries, so it is closed as rolled back.
		const written = (await readRecords(ports).catch(() => [])).some(other => other.id === id);
		if (written) {
			await setStatus(ports, id, 'rolled-back').catch(() => undefined);
		} else {
			await removeSnapshot(ports, id);
		}
		return { kind: 'could-not-finish', detail: errorText(error) };
	}

	// The progress entries of the parts the engine may have changed, in the order of the journal.
	const started: Progress[] = [];
	try {
		await applyRecord(ports, record, new Set(extraPaths.map(extra => extra.path)), started);
	} catch (error) {
		try {
			const outcome = await reverse(ports, { ...record, progress: started }, 'all-or-report');
			return outcome === 'reversed' ? { kind: 'could-not-finish', detail: errorText(error) } : { kind: 'interrupted' };
		} catch {
			// The record stays unresolved, so no further operation runs until it is resolved.
			await setStatus(ports, record.id, 'interrupted').catch(() => undefined);
			return { kind: 'interrupted' };
		}
	}
	return { kind: 'done', operationId: id, hookEditedFiles: extraPaths.map(extra => extra.path) };
}

/**
 * Steps 4 to 7 of the protocol. Before each change, the progress entry is appended to the
 * journal and to `started`.
 */
async function applyRecord(ports: EnginePorts, record: JournalRecord, alreadyWritten: Set<string>, started: Progress[]): Promise<void> {
	for (const plan of record.paths) {
		const [{ part }] = await classifyPaths(ports, [plan]);
		if (alreadyWritten.has(plan.path)) {
			if (!isAtAfter(plan, part)) {
				throw new StepRefused(`${plan.path} changed after the operation started`);
			}
			continue;
		}
		if (part !== 'before') {
			throw new StepRefused(`${plan.path} changed after the operation started`);
		}
		await announce(ports, record.id, started, { step: 'path', path: plan.path });
		await writePath(ports, plan, 'forward');
	}

	if (record.after.indexTree !== record.before.indexTree) {
		if (await readIndexTree(ports) !== record.before.indexTree) {
			throw new StepRefused('the index changed after the operation started');
		}
		await announce(ports, record.id, started, { step: 'index' });
		await setIndex(ports, record.after.indexTree);
	}

	if (record.after.branchCommit !== record.before.branchCommit) {
		await announce(ports, record.id, started, { step: 'branch' });
		try {
			await moveBranch(ports, record.branch, record.after.branchCommit, record.before.branchCommit);
		} catch (error) {
			if (error instanceof GitFailedError) {
				// Git refused the compare-and-swap, so the branch is as it was. The journal still
				// lists it, which only makes a recovery after a crash more careful.
				started.pop();
			}
			throw error;
		}
	}

	await setStatus(ports, record.id, 'complete');
}

/** Appends a progress entry durably, then lists it in `started`. */
async function announce(ports: EnginePorts, id: string, started: Progress[], entry: Progress): Promise<void> {
	await appendProgress(ports, id, entry);
	started.push(entry);
}

/** Removes the snapshot of a run that ended before its record was written, as far as possible. */
async function removeSnapshot(ports: EnginePorts, id: string): Promise<void> {
	await runGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', `${SNAPSHOT_REF_PREFIX}${id}`]).catch(() => undefined);
}

/** True when a path classified as `part` has the plan's after value. A value equal to both reads as before. */
function isAtAfter(plan: PathPlan, part: Part): boolean {
	return part === 'after' || (part === 'before' && plan.before === plan.after && plan.beforeMode === plan.afterMode);
}

/**
 * The paths that differ between the before and after working-file trees, removals first, then
 * `extraPaths` that are not among them. A file that is untracked in the before index is never
 * removed (spec 6.2), and submodules are not written.
 */
async function planPaths(ports: EnginePorts, before: TriState, after: TriState, extraPaths: PathPlan[]): Promise<PathPlan[]> {
	const git = (args: string[]) => mustGit(ports.git, ['-C', ports.projectRoot, ...args], { timeoutMs: STAGING_TIMEOUT_MS });
	const fields = splitZ((await git(['diff-tree', '-r', '-z', '--no-renames', before.worktreeTree, after.worktreeTree])).stdout);
	const tracked = new Set(splitZ((await git(['ls-tree', '-r', '-z', '--name-only', before.indexTree])).stdout));
	const removals: PathPlan[] = [];
	const writes: PathPlan[] = [];
	for (let index = 0; index + 1 < fields.length; index += 2) {
		// `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path.
		const [oldMode, newMode, oldBlob, newBlob] = fields[index].slice(1).split(' ');
		const file = fields[index + 1];
		const beforeMode = fileMode(oldMode);
		const afterMode = fileMode(newMode);
		if (beforeMode === undefined || afterMode === undefined) {
			continue;
		}
		const plan: PathPlan = {
			path: file,
			before: beforeMode === null ? null : oldBlob,
			after: afterMode === null ? null : newBlob,
			beforeMode,
			afterMode,
		};
		if (plan.after === null) {
			if (tracked.has(file)) {
				removals.push(plan);
			}
		} else {
			writes.push(plan);
		}
	}
	const listed = new Set([...removals, ...writes].map(plan => plan.path));
	return [...removals, ...writes, ...extraPaths.filter(extra => !listed.has(extra.path))];
}

/** The mode of a file the engine writes, null for an absent file, undefined for a submodule. */
function fileMode(mode: string): FileMode | null | undefined {
	if (mode === '000000') {
		return null;
	}
	return mode === '100644' || mode === '100755' || mode === '120000' ? mode : undefined;
}

/** The temporary file next to `file` that a write goes through. */
function temporaryPath(file: string): string {
	const folder = path.posix.dirname(file);
	const name = `.${path.posix.basename(file)}.positron-checkpoints-tmp`;
	return folder === '.' ? name : `${folder}/${name}`;
}

/**
 * Writes the after (`forward`) or before (`backward`) value of a path: the content `git
 * checkout` would write (`git cat-file --filters`, so line-ending conversion and smudge filters
 * apply) with an executable bit from the mode, a symbolic link for mode 120000, or a removal
 * for `null`. Such a file reads back as the same blob (see `readDiskEntries`). A file or link
 * is written to a temporary file in the same folder and renamed over the path, so the path
 * always has its old or its new content. Folders that a removal leaves empty are removed. The
 * caller confirms what is on disk first.
 */
export async function writePath(ports: EnginePorts, plan: PathPlan, direction: 'forward' | 'backward'): Promise<void> {
	const blob = direction === 'forward' ? plan.after : plan.before;
	const mode = direction === 'forward' ? plan.afterMode : plan.beforeMode;
	if (blob === null || mode === null) {
		await ports.files.remove(plan.path);
		for (let folder = path.posix.dirname(plan.path); folder !== '.' && folder !== '/'; folder = path.posix.dirname(folder)) {
			if (!await ports.files.removeEmptyDirectory(folder)) {
				break;
			}
		}
		return;
	}
	// A link target is never converted; a file gets the filters of its own path.
	const args = mode === '120000' ? ['cat-file', 'blob', blob] : ['cat-file', '--filters', `--path=${plan.path}`, blob];
	const content = Buffer.from((await mustGit(ports.git, ['-C', ports.projectRoot, ...args], { binary: true, timeoutMs: STAGING_TIMEOUT_MS })).stdout, 'latin1');
	const temporary = temporaryPath(plan.path);
	try {
		if (mode === '120000') {
			await ports.files.writeLink(temporary, content.toString('utf8'));
		} else {
			await ports.files.write(temporary, new Uint8Array(content), mode === '100755');
		}
		await ports.files.move(temporary, plan.path);
	} catch (error) {
		await ports.files.remove(temporary).catch(() => undefined);
		throw error;
	}
}

/**
 * Sets the real index to `tree`. A one-tree `read-tree -m` would keep file times but refuses an
 * index entry whose file differs on disk, which is the usual case here, so the plain form is used.
 */
async function setIndex(ports: EnginePorts, tree: string): Promise<void> {
	await mustGit(ports.git, ['-C', ports.projectRoot, 'read-tree', tree], { timeoutMs: STAGING_TIMEOUT_MS });
}

/** Moves the branch from `from` to `to` only while it is at `from`. A null value is an absent branch. */
async function moveBranch(ports: EnginePorts, branch: string, to: string | null, from: string | null): Promise<void> {
	const ref = `refs/heads/${branch}`;
	if (to === null) {
		await mustGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', ref, from!]);
		return;
	}
	// The all-zero old value means the branch must not exist.
	await mustGit(ports.git, ['-C', ports.projectRoot, 'update-ref', ref, to, from ?? '0'.repeat(to.length)]);
}

/**
 * The reversal procedure of spec 6.3.1, for rollback while the process runs and for recovery.
 * The record's progress lists every part the engine may have changed (an entry is written
 * before each change). It classifies the branch, the index, and every path, and restores only
 * a listed part that is "after", in reverse order of the progress entries (branch, index,
 * paths, kept files back to their places). A part that is not listed is never changed, even
 * when it is "after", because another tool put it there. Each part is checked again just
 * before it is restored, and "unexpected" content is never written over. A temporary file a
 * crash left next to a listed path is removed.
 *
 * A conflict is a part that is "unexpected" and listed, so the engine may have changed it
 * before another tool did. An unexpected part the engine never changed is the person's own
 * newer work, and leaving it is the rollback.
 *
 * - `all-or-report`: with no conflict, the record becomes `rolled-back` and the result is
 *   `reversed`. With a conflict, a recovery snapshot of the project is saved under
 *   `refs/positron-checkpoints/recovery/<id>` before anything is restored (unless it exists),
 *   the record becomes `interrupted`, and the result is `has-unexpected`.
 * - `keep-unexpected`: the person chose to keep newer content. The record becomes
 *   `rolled-back`, and the result is `has-unexpected` when unexpected content was left.
 */
export async function reverse(ports: EnginePorts, record: JournalRecord, mode: 'all-or-report' | 'keep-unexpected'): Promise<'reversed' | 'has-unexpected'> {
	const classification = await classify(ports, record);
	const listed = (entry: Progress) => record.progress.some(other => JSON.stringify(other) === JSON.stringify(entry));
	const conflict = (classification.branch === 'unexpected' && listed({ step: 'branch' }))
		|| (classification.index === 'unexpected' && listed({ step: 'index' }))
		|| classification.paths.some(({ path, part }) => part === 'unexpected' && listed({ step: 'path', path }));
	let leftUnexpected = mode === 'all-or-report'
		? conflict
		: classification.branch === 'unexpected' || classification.index === 'unexpected' || classification.paths.some(({ part }) => part === 'unexpected');

	if (mode === 'all-or-report' && conflict) {
		await saveRecoverySnapshot(ports, record);
	}

	for (const entry of [...record.progress].reverse()) {
		if (entry.step === 'branch' && classification.branch === 'after') {
			try {
				await moveBranch(ports, record.branch, record.before.branchCommit, record.after.branchCommit);
			} catch (error) {
				if (!(error instanceof GitFailedError)) {
					throw error;
				}
				// Another tool moved the branch since it was classified.
				leftUnexpected = true;
			}
		} else if (entry.step === 'index' && classification.index === 'after') {
			if (await readIndexTree(ports) === record.after.indexTree) {
				await setIndex(ports, record.before.indexTree);
			} else {
				leftUnexpected = true;
			}
		} else if (entry.step === 'path') {
			const temporary = temporaryPath(entry.path);
			if (await ports.files.lstat(temporary) !== undefined) {
				await ports.files.remove(temporary);
			}
			const plan = record.paths.find(candidate => candidate.path === entry.path);
			if (plan === undefined || classification.paths.find(({ path }) => path === entry.path)?.part !== 'after') {
				continue;
			}
			const [{ part }] = await classifyPaths(ports, [plan]);
			if (part === 'after') {
				await writePath(ports, plan, 'backward');
			} else if (part === 'unexpected') {
				leftUnexpected = true;
			}
		} else if (entry.step === 'kept') {
			if (await ports.files.lstat(entry.from) === undefined && await ports.files.lstat(entry.to) !== undefined) {
				await ports.files.move(entry.to, entry.from);
			}
		}
	}

	if (mode === 'all-or-report' && leftUnexpected) {
		// Content changed while it was being restored; keep a copy of the project as it is now.
		await saveRecoverySnapshot(ports, record);
	}
	await setStatus(ports, record.id, mode === 'all-or-report' && leftUnexpected ? 'interrupted' : 'rolled-back');
	return leftUnexpected ? 'has-unexpected' : 'reversed';
}

/** Saves `refs/positron-checkpoints/recovery/<id>` unless it exists. */
async function saveRecoverySnapshot(ports: EnginePorts, record: JournalRecord): Promise<void> {
	const ref = `${RECOVERY_REF_PREFIX}${record.id}`;
	const existing = await runGit(ports.git, ['-C', ports.projectRoot, 'rev-parse', '--verify', '-q', ref]);
	if (existing.exitCode === 0) {
		return;
	}
	const branchCommit = await readBranch(ports, record.branch);
	await saveSnapshot(ports, record.id, branchCommit ?? undefined, RECOVERY_REF_PREFIX);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
