/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { findCollisions } from './collisions';
import { GitFailedError, mustGit, runGit, splitZ } from './git';
import {
	acquireLock, appendProgress, classify, classifyPaths, FileMode, JournalRecord, Part, PathPlan,
	Progress, readBranch, readIndexTree, setStatus, TriState, writeRecord,
} from './journal';
import { EnginePorts } from './ports';
import { RECOVERY_REF_PREFIX, saveSnapshot, STAGING_TIMEOUT_MS } from './trees';
import { CollisionChoice, OperationKind, OperationResult } from './types';

export interface OperationPlan {
	kind: OperationKind; description: string;
	/** Computed by the caller in the object database. */
	after: TriState;
	collisionChoices: CollisionChoice[];
	/** Files a hook already changed on disk: `before` is their earlier content and `after` is what is on disk now. */
	extraPaths?: PathPlan[];
}

/** A step found a part that is no longer at the value the record expects. */
class StepRefused extends Error { }

/**
 * Runs an operation through the protocol of spec 6.3.1: take the lock, record the before state
 * with a snapshot, derive the paths to write, run the collision check, journal the record, then
 * change the working files (each only while it still has its before content), the index (only
 * while it still has its before tree), and last the branch (a compare-and-swap), and mark the
 * record complete.
 *
 * On any failure it runs `reverse(record, 'all-or-report')`: a clean reversal returns
 * `could-not-finish` with status `rolled-back`; content changed by another tool after the engine
 * wrote it returns `interrupted` with status `interrupted` and a recovery snapshot. A failure
 * during the reversal itself is thrown and leaves the record `prepared`, so startup recovery
 * finds it.
 */
export async function runOperation(ports: EnginePorts, plan: OperationPlan): Promise<OperationResult> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	try {
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
		const paths = await planPaths(ports, before, plan.after, extraPaths);
		const collisions = await findCollisions(ports, paths, snapshot.skipped);
		const unanswered = collisions.filter(collision => !plan.collisionChoices.some(choice => choice.path === collision.path));
		if (unanswered.length > 0) {
			return { kind: 'path-collisions', collisions: unanswered };
		}
		record = {
			id, kind: plan.kind, description: plan.description, time: ports.now().toISOString(), branch,
			before, after: plan.after, paths, skipped: snapshot.skipped,
			keptMoves: [], progress: [], status: 'prepared',
		};
		await writeRecord(ports, record);
	} catch (error) {
		// Nothing visible has changed yet.
		return { kind: 'could-not-finish', detail: errorText(error) };
	}

	// Each part is listed before the engine starts to change it, so a reversal knows every part
	// the engine may have changed, including one whose change failed halfway.
	const started: Progress[] = [];
	try {
		await applyRecord(ports, record, new Set(extraPaths.map(extra => extra.path)), started);
	} catch (error) {
		const outcome = await reverse(ports, { ...record, progress: started }, 'all-or-report');
		return outcome === 'reversed' ? { kind: 'could-not-finish', detail: errorText(error) } : { kind: 'interrupted' };
	}
	return { kind: 'done', operationId: id, hookEditedFiles: extraPaths.map(extra => extra.path) };
}

/** Steps 4 to 7 of the protocol. Appends to `started` before each change. */
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
		const entry: Progress = { step: 'path', path: plan.path };
		started.push(entry);
		await writePath(ports, plan, 'forward');
		await appendProgress(ports, record.id, entry);
	}

	if (record.after.indexTree !== record.before.indexTree) {
		if (await readIndexTree(ports) !== record.before.indexTree) {
			throw new StepRefused('the index changed after the operation started');
		}
		started.push({ step: 'index' });
		await setIndex(ports, record.after.indexTree);
		await appendProgress(ports, record.id, { step: 'index' });
	}

	if (record.after.branchCommit !== record.before.branchCommit) {
		started.push({ step: 'branch' });
		try {
			await moveBranch(ports, record.branch, record.after.branchCommit, record.before.branchCommit);
		} catch (error) {
			if (error instanceof GitFailedError) {
				// Git refused the compare-and-swap, so the branch is as it was.
				started.pop();
			}
			throw error;
		}
		await appendProgress(ports, record.id, { step: 'branch' });
	}

	await setStatus(ports, record.id, 'complete');
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

/**
 * Writes the after (`forward`) or before (`backward`) value of a path: the blob's exact bytes
 * with no line-ending conversion or filter, an executable bit from the mode, a symbolic link
 * for mode 120000, or a removal for `null`. Under `core.autocrlf` such a file reads back as the
 * same blob (see `readDiskEntries`). Folders that a removal leaves empty are removed. The caller
 * confirms what is on disk first.
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
	const content = Buffer.from((await mustGit(ports.git, ['-C', ports.projectRoot, 'cat-file', 'blob', blob], { binary: true, timeoutMs: STAGING_TIMEOUT_MS })).stdout, 'latin1');
	if (mode === '120000') {
		await ports.files.writeLink(plan.path, content.toString('utf8'));
	} else {
		await ports.files.write(plan.path, new Uint8Array(content), mode === '100755');
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
 * It classifies the branch, the index, and every path, and restores only a part that is
 * "after", in reverse order of the record's progress entries (branch, index, paths, kept files
 * back to their places), then any other part that is "after". Each part is checked again just
 * before it is restored, and "unexpected" content is never written over.
 *
 * A conflict is a part that is "unexpected" and that the record's progress lists, so the
 * engine may have changed it before another tool did. An unexpected part the engine never
 * changed is the person's own newer work, and leaving it is the rollback.
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

	const order: Progress[] = [...record.progress].reverse();
	const remaining: Progress[] = [
		{ step: 'branch' },
		{ step: 'index' },
		...[...record.paths].reverse().map((plan): Progress => ({ step: 'path', path: plan.path })),
		...[...record.keptMoves].reverse().map((move): Progress => ({ step: 'kept', ...move })),
	];
	for (const entry of remaining) {
		if (!listed(entry)) {
			order.push(entry);
		}
	}

	for (const entry of order) {
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
