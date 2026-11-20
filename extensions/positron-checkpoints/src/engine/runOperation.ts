/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'crypto';
import * as path from 'path';
import { findCollisions, keptPath, moveAside, moveBack } from './collisions';
import { GitFailedError, mustGit, runGit, splitZ } from './git';
import {
	acquireLock, appendProgress, classify, classifyPaths, engineDirectory, FileMode, JournalRecord, KeptMove, OperationRole, Part, PathPlan,
	Progress, readBranch, readDiskEntries, readIndexTree, readRecords, setStatus, TriState, writeRecord,
} from './journal';
import { EnginePorts } from './ports';
import { RECOVERY_REF_PREFIX, saveSnapshot, SNAPSHOT_REF_PREFIX, STAGING_TIMEOUT_MS } from './trees';
import { CollisionChoice, OperationKind, OperationResult, PathCollision } from './types';

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
	/** Set for an Undo or a Redo; copied into the record. */
	role?: OperationRole;
	/** Files an earlier operation kept aside, moved back once the operation is complete; copied into the record. */
	returnKept?: JournalRecord['returnKept'];
	/**
	 * Files an earlier operation created: its record lists each with a before value of absent and
	 * the content it wrote as `after`. When `after` drops such a file, it is removed even though
	 * the before index does not track it, but only while it still has that content and mode.
	 */
	removableCreated?: PathPlan[];
	/**
	 * Files on disk in the way of the operation that the caller found, beyond those the collision
	 * check finds. They are answered and moved aside as its collisions are.
	 */
	extraCollisions?: PathCollision[];
}

/** A step found a part that is no longer at the value the record expects. */
class StepRefused extends Error { }

/**
 * Runs an operation through the protocol of spec 6.3.1: take the lock, refuse while an earlier
 * operation is unresolved, record the before state with a snapshot, return `changes-moved` when
 * it differs from `plan.expected`, derive the paths to write, run the collision check and add
 * `plan.extraCollisions` (a collision without a `use-theirs-keep-copy` choice returns
 * `path-collisions`), journal the
 * record, then move the chosen collided files aside, change the working files (each only while it still has its before content),
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
		const paths = await planPaths(ports, before, plan.after, extraPaths, plan.removableCreated ?? []);
		const collisions = withExtraCollisions(await findCollisions(ports, paths, snapshot.skipped), plan.extraCollisions ?? []);
		const unanswered = collisions.filter(collision => !plan.collisionChoices.some(choice => choice.path === collision.path));
		if (unanswered.length > 0) {
			await removeSnapshot(ports, id);
			return { kind: 'path-collisions', collisions: unanswered };
		}
		// The size and blob id of each file to move aside let recovery tell that it is unchanged.
		const disk = await readDiskEntries(ports, collisions.map(collision => ({ path: collision.path, before: null, after: null, beforeMode: null, afterMode: null })));
		const keptMoves: KeptMove[] = [];
		for (const collision of collisions) {
			const entry = disk.get(collision.path);
			const blob = entry !== null && entry !== undefined && entry !== 'other' ? entry.blob : null;
			keptMoves.push({ from: collision.path, to: await keptPath(ports, id, collision.path), sizeBytes: collision.sizeBytes, blob });
		}
		record = {
			id, kind: plan.kind, description: plan.description, time: ports.now().toISOString(), branch,
			before, after: plan.after, paths, skipped: snapshot.skipped,
			keptMoves, progress: [], status: 'prepared',
		};
		if (plan.role !== undefined) {
			record.role = plan.role;
		}
		if (plan.returnKept !== undefined && plan.returnKept.moves.length > 0) {
			record.returnKept = plan.returnKept;
		}
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
	// The operation is complete. A file that cannot be moved back now stays listed in the kept
	// folder, and `recoverOnStart` tries again.
	await returnKeptFiles(ports, record).catch(() => undefined);
	return { kind: 'done', operationId: id, hookEditedFiles: extraPaths.map(extra => extra.path) };
}

/**
 * Moves the files of a complete record's `returnKept` back to their places, still under the
 * lock, then appends a `kept-returned` entry. A file whose place is taken stays in the kept
 * folder, listed for the person. Does nothing for a record without `returnKept` or with that
 * entry, so a call after a crash finishes what the first call started.
 */
export async function returnKeptFiles(ports: EnginePorts, record: JournalRecord): Promise<void> {
	if (record.returnKept === undefined || record.progress.some(entry => entry.step === 'kept-returned')) {
		return;
	}
	for (const move of record.returnKept.moves) {
		await moveBack(ports, record.returnKept.operationId, move);
	}
	await appendProgress(ports, record.id, { step: 'kept-returned' });
}

/**
 * Steps 4 to 7 of the protocol. Before each change, the progress entry is appended to the
 * journal and to `started`. Once the record is complete, the originals kept in its backup folder
 * are removed.
 */
async function applyRecord(ports: EnginePorts, record: JournalRecord, alreadyWritten: Set<string>, started: Progress[]): Promise<void> {
	const backups = await backupDirectory(ports, record.id);
	// Files outside the snapshot that the person chose to keep a copy of go aside first (spec 6.2).
	for (const move of record.keptMoves) {
		await announce(ports, record.id, started, { step: 'kept', ...move });
		if (await ports.files.lstat(move.from) !== undefined) {
			await moveAside(ports, record.id, move.from, record.description);
		}
	}
	for (const plan of record.paths) {
		if (alreadyWritten.has(plan.path)) {
			const [{ part }] = await classifyPaths(ports, [plan]);
			// A hook that replaced a file with a folder left a folder at a path whose after value is
			// no file; the folder's files are paths of their own.
			const folderInPlace = plan.after === null && (await ports.files.lstat(plan.path))?.isDirectory === true;
			if (!isAtAfter(plan, part) && !folderInPlace) {
				throw new StepRefused(`${plan.path} changed after the operation started`);
			}
			continue;
		}
		await writeForward(ports, record.id, plan, backups, started);
	}

	if (record.after.indexTree !== record.before.indexTree) {
		await applyIndex(ports, record, started);
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

	await markComplete(ports, record.id, backups);
}

/**
 * Sets the real index to the record's after tree, after confirming that it is still at its
 * before tree. Checked right before the change; another tool could still stage work in the few
 * milliseconds before `read-tree` runs, and that window is accepted.
 */
async function applyIndex(ports: EnginePorts, record: JournalRecord, started: Progress[]): Promise<void> {
	await announce(ports, record.id, started, { step: 'index' });
	if (await readIndexTree(ports) !== record.before.indexTree) {
		started.pop();
		throw new StepRefused('the index changed after the operation started');
	}
	await setIndex(ports, record.after.indexTree);
}

/** Marks the record complete, then removes the originals kept in its backup folder. */
async function markComplete(ports: EnginePorts, id: string, backups: string): Promise<void> {
	await setStatus(ports, id, 'complete');
	// The operation is decided; a folder that cannot be removed now only takes space.
	await ports.files.remove(backups).catch(() => undefined);
}

/**
 * Finishes an operation whose branch is already at its after commit (recovery after a crash,
 * spec 6.3.1 step 3). Temporary files the journal names are removed. Each path not yet at its
 * after value is written as `runOperation` writes it (only while it is at its before value),
 * then the index is set when it is still at its before tree, and the record becomes complete.
 * The caller has confirmed that no part is unexpected.
 */
export async function rollForward(ports: EnginePorts, record: JournalRecord): Promise<void> {
	const backups = await backupDirectory(ports, record.id);
	const started = [...record.progress];
	await removeTemporaryFiles(ports, record.progress);
	for (const plan of record.paths) {
		const [{ part }] = await classifyPaths(ports, [plan]);
		if (!isAtAfter(plan, part)) {
			await writeForward(ports, record.id, plan, backups, started);
		}
	}
	if (await readIndexTree(ports) !== record.after.indexTree) {
		await applyIndex(ports, record, started);
	}
	await markComplete(ports, record.id, backups);
}

/** Removes each temporary file that a path entry of `progress` names and that still exists. */
async function removeTemporaryFiles(ports: EnginePorts, progress: Progress[]): Promise<void> {
	for (const entry of progress) {
		if (entry.step === 'path' && entry.temporary !== undefined && await ports.files.lstat(entry.temporary) !== undefined) {
			await ports.files.remove(entry.temporary);
		}
	}
}

/**
 * Writes the after value of one path. The progress entry, with the name of the temporary file,
 * is appended first. The new content is then made ready in that temporary file, and only then is
 * the path checked against its before value, so the check comes right before the change. Another
 * tool could still write the path in the few milliseconds between the check and the rename; that
 * window is accepted. The original file gets a second name in the backup folder (a removal moves
 * it there), and the temporary file is renamed over the path, so the path always has its old or
 * its new content. A path that is no longer at its before value stops the operation, and its
 * entry is taken back out of `started`, because nothing was changed.
 */
async function writeForward(ports: EnginePorts, id: string, plan: PathPlan, backups: string, started: Progress[]): Promise<void> {
	const temporary = plan.after === null ? undefined : temporaryPath(plan.path);
	await announce(ports, id, started, temporary === undefined ? { step: 'path', path: plan.path } : { step: 'path', path: plan.path, temporary });
	if (temporary !== undefined) {
		await fillTemporary(ports, plan, temporary);
	}
	const [{ part }] = await classifyPaths(ports, [plan]);
	if (part !== 'before') {
		if (temporary !== undefined) {
			await ports.files.remove(temporary);
		}
		started.pop();
		throw new StepRefused(`${plan.path} changed after the operation started`);
	}
	const backup = `${backups}/${plan.path}`;
	if (temporary === undefined) {
		await ports.files.move(plan.path, backup);
		await removeEmptyFolders(ports, plan.path);
		return;
	}
	if (plan.before !== null) {
		await ports.files.linkOrCopy(plan.path, backup);
	}
	await ports.files.move(temporary, plan.path);
}

/**
 * Creates `temporary`, which must not exist, with the after value of `plan`: the content `git
 * checkout` would write (`git cat-file --filters`, so line-ending conversion and smudge filters
 * apply), streamed from git to the file, or a symbolic link for mode 120000. Such a file reads
 * back as the same blob (see `readDiskEntries`). A file gets the permission bits of the file it
 * replaces (or those a new file gets), with the executable bit of the after mode.
 */
async function fillTemporary(ports: EnginePorts, plan: PathPlan, temporary: string): Promise<void> {
	if (plan.afterMode === '120000') {
		// A link target is never converted.
		const target = Buffer.from((await mustGit(ports.git, ['-C', ports.projectRoot, 'cat-file', 'blob', plan.after!], { binary: true })).stdout, 'latin1').toString('utf8');
		if (!await ports.files.createLinkExclusive(temporary, target)) {
			throw new Error(`${temporary} already exists`);
		}
		return;
	}
	if (!await ports.files.createExclusive(temporary, '')) {
		throw new Error(`${temporary} already exists`);
	}
	await mustGit(ports.git, ['-C', ports.projectRoot, 'cat-file', '--filters', `--path=${plan.path}`, plan.after!], {
		stdoutToFile: path.resolve(ports.projectRoot, temporary),
		timeoutMs: STAGING_TIMEOUT_MS,
	});
	await ports.files.setPermissions(temporary, plan.afterMode === '100755', plan.path);
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

/** `found` with each of `extra` whose path it does not list, sorted by path. */
function withExtraCollisions(found: PathCollision[], extra: PathCollision[]): PathCollision[] {
	const listed = new Set(found.map(collision => collision.path));
	return [...found, ...extra.filter(collision => !listed.has(collision.path))]
		.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

/**
 * The paths that differ between the before and after working-file trees, removals first, then
 * `extraPaths` that are not among them. A file that is untracked in the before index is never
 * removed (spec 6.2), unless `removableCreated` lists it with its current content and mode (an
 * earlier operation created it, and it is unchanged since). Submodules are not written.
 */
async function planPaths(ports: EnginePorts, before: TriState, after: TriState, extraPaths: PathPlan[], removableCreated: PathPlan[]): Promise<PathPlan[]> {
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
			const created = removableCreated.some(earlier => earlier.path === file && earlier.before === null && earlier.after === plan.before && earlier.afterMode === plan.beforeMode);
			if (tracked.has(file) || created) {
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
export function fileMode(mode: string): FileMode | null | undefined {
	if (mode === '000000') {
		return null;
	}
	return mode === '100644' || mode === '100755' || mode === '120000' ? mode : undefined;
}

/** The folder where an operation keeps the original files it replaced or removed, until it is decided. */
export async function backupDirectory(ports: EnginePorts, id: string): Promise<string> {
	return `${await engineDirectory(ports)}/backup/${id}`;
}

/**
 * A new temporary file name next to `file`, with a random part so it is never the name of a
 * file the person has. The base name is shortened so the name stays within file system limits.
 */
function temporaryPath(file: string): string {
	const folder = path.posix.dirname(file);
	const name = `.${path.posix.basename(file).slice(0, 100)}.${randomBytes(6).toString('hex')}.positron-checkpoints-tmp`;
	return folder === '.' ? name : `${folder}/${name}`;
}

/** Removes the folders above `file` that are empty, nearest first. */
async function removeEmptyFolders(ports: EnginePorts, file: string): Promise<void> {
	for (let folder = path.posix.dirname(file); folder !== '.' && folder !== '/'; folder = path.posix.dirname(folder)) {
		if (!await ports.files.removeEmptyDirectory(folder)) {
			break;
		}
	}
}

/**
 * Returns a path that has its after value to its before value: a file the operation created is
 * removed (with folders that leaves empty), and an original kept in the backup folder is moved
 * back over the path, with its own bytes and permission bits. Returns false, and changes
 * nothing, when the original is missing from the backup folder.
 */
async function restorePath(ports: EnginePorts, plan: PathPlan, backups: string): Promise<boolean> {
	if (plan.before === null) {
		await ports.files.remove(plan.path);
		await removeEmptyFolders(ports, plan.path);
		return true;
	}
	const backup = `${backups}/${plan.path}`;
	if (await ports.files.lstat(backup) === undefined) {
		return false;
	}
	await ports.files.move(backup, plan.path);
	return true;
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
 * before it is restored, and "unexpected" content is never written over. A path gets back the
 * original kept in the record's backup folder; a path whose original is missing there is left
 * as it is and counts as unexpected. A temporary file that a listed entry names is removed.
 * Once the record is `rolled-back`, its backup folder is removed.
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
	const backups = await backupDirectory(ports, record.id);
	const listed = (step: Progress['step'], file?: string) => record.progress.some(entry => entry.step === step && (entry.step !== 'path' || entry.path === file));
	const conflict = (classification.branch === 'unexpected' && listed('branch'))
		|| (classification.index === 'unexpected' && listed('index'))
		|| classification.paths.some(({ path, part }) => part === 'unexpected' && listed('path', path));
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
			await removeTemporaryFiles(ports, [entry]);
			const plan = record.paths.find(candidate => candidate.path === entry.path);
			if (plan === undefined || classification.paths.find(({ path }) => path === entry.path)?.part !== 'after') {
				continue;
			}
			const [{ part }] = await classifyPaths(ports, [plan]);
			if (part === 'after') {
				if (!await restorePath(ports, plan, backups)) {
					leftUnexpected = true;
				}
			} else if (part === 'unexpected') {
				leftUnexpected = true;
			}
		} else if (entry.step === 'kept') {
			// A kept file whose place is taken stays in the kept folder, listed for the person.
			await moveBack(ports, record.id, entry);
		}
	}

	if (mode === 'all-or-report' && leftUnexpected) {
		// Content changed while it was being restored; keep a copy of the project as it is now.
		await saveRecoverySnapshot(ports, record);
	}
	const status = mode === 'all-or-report' && leftUnexpected ? 'interrupted' : 'rolled-back';
	await setStatus(ports, record.id, status);
	if (status === 'rolled-back') {
		await ports.files.remove(backups).catch(() => undefined);
	}
	return leftUnexpected ? 'has-unexpected' : 'reversed';
}

/**
 * Saves `refs/positron-checkpoints/recovery/<id>`, a snapshot of the working files and the index
 * as they are now, unless it exists.
 */
export async function saveRecoverySnapshot(ports: EnginePorts, record: JournalRecord): Promise<void> {
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
