/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mustGit, splitZ } from './git';
import { acquireLock, classify, JournalRecord, readRecords, setStatus } from './journal';
import { EnginePorts } from './ports';
import { backupDirectory, reverse, rollForward, saveRecoverySnapshot } from './runOperation';
import { RECOVERY_REF_PREFIX, SNAPSHOT_REF_PREFIX } from './trees';
import { EngineState, OperationResult } from './types';

/** What startup recovery found and did. */
export interface RecoveryOutcome {
	/** An operation was finished automatically, by reversing or completing it. */
	notice?: 'reversed' | 'completed';
	/** An operation is unresolved because the project changed after it; `resolveInterrupted` resolves it. */
	interrupted?: EngineState['interrupted'];
	/** The branch is at neither commit of an operation, or a recovery step failed. Names the refs to restore from. */
	unrecovered?: string;
}

/**
 * Spec 6.3.1, recovery after the process died. Runs before the engine serves a request. For
 * every record with status `prepared` or `interrupted`, it first saves the recovery snapshot
 * (`refs/positron-checkpoints/recovery/<id>`, unless it exists), so nothing is written to the
 * project before it exists. Then it classifies the record:
 *
 * - The branch is at neither commit (for an `interrupted` record, only when the engine may have
 *   moved it): nothing is written and the record stays as it is; `unrecovered` names the refs.
 * - Any path or the index is "unexpected", or the record is `interrupted` (a live reversal that
 *   could not finish): nothing is written, the record becomes `interrupted`, and it is reported
 *   through `interrupted`. Only `resolveInterrupted` resolves it.
 * - Otherwise, with the branch at the after commit the operation is completed, and else it is
 *   reversed; `notice` says which. Content that changes during the reversal is left and reported
 *   through `interrupted`.
 *
 * A failed step gives `unrecovered`. When another window holds the engine lock, that window
 * owns the journal, and nothing is done.
 */
export async function recoverOnStart(ports: EnginePorts): Promise<RecoveryOutcome> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return {};
	}
	try {
		const outcome: RecoveryOutcome = {};
		for (const record of await readRecords(ports)) {
			if (record.status !== 'prepared' && record.status !== 'interrupted') {
				continue;
			}
			const found = await recoverRecord(ports, record);
			outcome.notice = found.notice ?? outcome.notice;
			outcome.interrupted ??= found.interrupted;
			outcome.unrecovered ??= found.unrecovered;
		}
		return outcome;
	} finally {
		await lock.release().catch(() => undefined);
	}
}

async function recoverRecord(ports: EnginePorts, record: JournalRecord): Promise<RecoveryOutcome> {
	try {
		await saveRecoverySnapshot(ports, record);
		const classification = await classify(ports, record);
		const branchMayBeOurs = record.status === 'prepared' || record.progress.some(entry => entry.step === 'branch');
		if (classification.branch === 'unexpected' && branchMayBeOurs) {
			return { unrecovered: unrecoveredDetail(record, `The branch ${record.branch} is at neither the commit before nor the commit after the action.`) };
		}
		const unexpectedPaths = classification.paths.filter(({ part }) => part === 'unexpected').map(({ path }) => path);
		const indexUnexpected = classification.index === 'unexpected';
		if (record.status === 'interrupted' || unexpectedPaths.length > 0 || indexUnexpected) {
			if (record.status !== 'interrupted') {
				await setStatus(ports, record.id, 'interrupted');
			}
			return { interrupted: { operationId: record.id, description: record.description, unexpectedPaths, indexUnexpected } };
		}
		if (classification.branch === 'after') {
			await rollForward(ports, record);
			return { notice: 'completed' };
		}
		if (await reverse(ports, record, 'all-or-report') === 'reversed') {
			return { notice: 'reversed' };
		}
		// Content changed while it was being restored.
		const now = await classify(ports, record);
		return {
			interrupted: {
				operationId: record.id,
				description: record.description,
				unexpectedPaths: now.paths.filter(({ part }) => part === 'unexpected').map(({ path }) => path),
				indexUnexpected: now.index === 'unexpected',
			},
		};
	} catch (error) {
		return { unrecovered: unrecoveredDetail(record, `Recovery stopped: ${error instanceof Error ? error.message : String(error)}.`) };
	}
}

/** The detail of an unrecovered operation, with the refs a person with git knowledge can restore from. */
function unrecoveredDetail(record: JournalRecord, reason: string): string {
	return `${reason} The project as it was before the action is in ${SNAPSHOT_REF_PREFIX}${record.id}, and as it was found at startup in ${RECOVERY_REF_PREFIX}${record.id}.`;
}

/**
 * Resolves the `interrupted` record, after saving its recovery snapshot when it has none.
 * `reverse-keep-newer` reverses every part the engine wrote that nothing has changed since, and
 * leaves each unexpected path and an unexpected index as they are (status `rolled-back`).
 * `leave-as-is` changes nothing in the project and marks the record `abandoned`. Both keep the
 * recovery snapshot. Returns `done` with the record's id, `unavailable busy` while another
 * window holds the lock, `unavailable nothing-to-do` when no record is interrupted, and
 * `could-not-finish` when a step fails (the record then keeps the status it had when the step failed).
 */
export async function resolveInterrupted(ports: EnginePorts, choice: 'reverse-keep-newer' | 'leave-as-is'): Promise<OperationResult> {
	const lock = await acquireLock(ports);
	if (lock === undefined) {
		return { kind: 'unavailable', reason: 'busy' };
	}
	try {
		const record = (await readRecords(ports)).find(candidate => candidate.status === 'interrupted');
		if (record === undefined) {
			return { kind: 'unavailable', reason: 'nothing-to-do' };
		}
		try {
			await saveRecoverySnapshot(ports, record);
			if (choice === 'reverse-keep-newer') {
				await reverse(ports, record, 'keep-unexpected');
			} else {
				await setStatus(ports, record.id, 'abandoned');
				// The person chose the project as it is; the originals the engine replaced are
				// still in the operation's snapshot.
				await ports.files.remove(await backupDirectory(ports, record.id)).catch(() => undefined);
			}
			return { kind: 'done', operationId: record.id, hookEditedFiles: [] };
		} catch (error) {
			return { kind: 'could-not-finish', detail: error instanceof Error ? error.message : String(error) };
		}
	} finally {
		await lock.release().catch(() => undefined);
	}
}

/** Every recovery snapshot, oldest first, with the time it was saved. */
export async function listRecoverySnapshots(ports: EnginePorts): Promise<{ operationId: string; time: string }[]> {
	const output = (await mustGit(ports.git, ['-C', ports.projectRoot, 'for-each-ref', '--format=%(refname)%00%(committerdate:unix)%00', RECOVERY_REF_PREFIX])).stdout;
	// Each ref gives "<name>\0<seconds>\0" and a line break.
	const fields = splitZ(output.replace(/\n/g, ''));
	const snapshots: { operationId: string; time: string }[] = [];
	for (let index = 0; index + 1 < fields.length; index += 2) {
		snapshots.push({ operationId: fields[index].slice(RECOVERY_REF_PREFIX.length), time: new Date(Number(fields[index + 1]) * 1000).toISOString() });
	}
	return snapshots.sort((left, right) => left.time.localeCompare(right.time));
}

/** Removes the recovery snapshot of `operationId`. A snapshot that does not exist is not an error. */
export async function removeRecoverySnapshot(ports: EnginePorts, operationId: string): Promise<void> {
	await mustGit(ports.git, ['-C', ports.projectRoot, 'update-ref', '-d', `${RECOVERY_REF_PREFIX}${operationId}`]);
}
