/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import {
	acceptCheckedCheckpoint, createCheckpoints, declineCheckedCheckpoint, editDescription, readPendingApproval, reverseCheckpoint, revision,
} from './checkpoints';
import { deleteKept, listKept, restoreKept } from './collisions';
import { GitMissingError, GitTimeoutError, runGit } from './git';
import { goBackTo } from './goBack';
import { getCheckpointFiles, getDiff, getHistory, getPendingFiles, readBlob } from './history';
import { classify, JournalRecord, readRecords } from './journal';
import { expire, redo, redoHead, undo, undoHead } from './operationLog';
import { EnginePorts } from './ports';
import { listRecoverySnapshots, recoverOnStart, removeRecoverySnapshot, resolveInterrupted } from './recovery';
import { isSyncAvailable, readRepoFacts, RepoFacts } from './repoState';
import { proposedGitignore, startTracking } from './startTracking';
import { checkShared, connectSharedCopy, getIncoming, previewIncoming, repairConnect, sendChanges } from './sync';
import { ChangeSet, CheckpointsEngine, EngineState, IncomingPreview, OperationKind, OperationResult } from './types';

/** The engine that `createEngine` returns: the bridge interface, plus the host's own calls. */
export interface Engine extends CheckpointsEngine {
	/** Fires `onDidChangeState`, for a change the host saw (a file saved, the window focused). */
	notifyChanged(): void;
	/** Removes every listener. Later events reach no one. */
	dispose(): void;
}

/** Kinds whose undo and redo always set the working files to a snapshot (spec 6.3). */
const RESTORES_SNAPSHOT = new Set<OperationKind>(['get-changes', 'go-back']);

/** What a mutating call needs before it runs. */
interface Guard {
	/** Allowed in a plain folder (`startTracking`). */
	plainFolder?: boolean;
	/** Allowed while an interrupted action is unresolved, and in an unusual state other than a missing git (`resolveInterrupted`). */
	resolving?: boolean;
}

/**
 * Creates the engine for `ports.openedFolder` (spec 5.1). Startup recovery (`recoverOnStart`, spec
 * 6.3.1), the repair of an unfinished `connectSharedCopy` (`repairConnect`), and the retention
 * rule (`expire`) run before the promise resolves, so no request is served before them.
 *
 * Mutating calls run one at a time: a call made while another runs returns `unavailable busy` at
 * once. `checkShared` changes no files and no local branch, so it runs beside them under the same
 * rules apart from that one; a `checkShared` call made while another runs returns the promise of
 * the one that runs. Before a mutating call computes anything or runs a project's hooks, it is refused with
 * `unavailable unusual-state` (detail: the unusual kind) in an unusual state, `unavailable
 * not-tracking` in a plain folder (apart from `startTracking`), and `unavailable busy` (detail
 * `unresolved-operation`) while an action is interrupted or unfinished (apart from
 * `resolveInterrupted`). A git call that outlives its time limit gives `unavailable timed-out`, a
 * git program that cannot start gives `unavailable unusual-state git-missing`, and any other
 * error is logged through `ports.log` and gives `could-not-finish`. A call that ran then applies
 * the retention rule (`expire`) and fires `onDidChangeState`.
 *
 * Read calls never take the lock. In a plain folder they return empty results. A read call whose
 * git call outlives its time limit rejects with an `Error` whose message starts with
 * `checkpoints:timed-out: `, and one whose git program cannot start with `checkpoints:git-missing: `
 * (see `CheckpointsEngine`); any other failure rejects with its own error.
 */
export async function createEngine(base: EnginePorts): Promise<Engine> {
	let ports: EnginePorts = base;
	const listeners = new Set<() => void>();
	let running = false;
	/** The `checkShared` call that runs now. */
	let checking: Promise<OperationResult> | undefined;
	/** Whether git has `merge-tree --merge-base`, asked once. */
	let syncAvailable: boolean | undefined;
	let recoveryNotice: EngineState['recoveryNotice'];
	/** Why startup recovery could not finish, while the operation it names is unresolved. */
	let unrecovered: string | undefined;
	/** The local and shared commits when the latest preview found overlaps. */
	let overlapInputs: { head: string; upstream: string } | undefined;
	let lastChecked: string | undefined;

	const log = (message: string) => {
		try {
			ports.log?.(message);
		} catch {
			// A failing log must not change the result.
		}
	};

	const fire = () => {
		for (const listener of [...listeners]) {
			try {
				listener();
			} catch (error) {
				log(`A state listener failed: ${errorText(error)}`);
			}
		}
	};

	/** The repository facts, with the project root of `ports` set to the repository's top level. */
	const readFacts = async (): Promise<RepoFacts> => {
		if (syncAvailable === undefined) {
			try {
				syncAvailable = await isSyncAvailable(ports, ports.openedFolder);
			} catch (error) {
				// Without a git program, `readRepoFacts` reports the unusual state.
				if (!(error instanceof GitMissingError)) {
					throw error;
				}
			}
		}
		const facts = await readRepoFacts(ports, { syncAvailable: syncAvailable ?? false });
		if (facts.isProject && facts.root !== ports.projectRoot) {
			ports = { ...ports, projectRoot: facts.root };
		}
		return facts;
	};

	const isProjectFolder = async (): Promise<boolean> => {
		const result = await ports.git(['-C', ports.openedFolder, 'rev-parse', '--show-toplevel']);
		return result.exitCode === 0 && !result.timedOut;
	};

	const unresolvedRecords = async (): Promise<JournalRecord[]> =>
		(await readRecords(ports)).filter(record => record.status === 'prepared' || record.status === 'interrupted');

	/**
	 * Runs a mutating call under the rules of `createEngine`. `call` gets the ports with the
	 * project root of the repository.
	 */
	const mutate = async (guard: Guard, call: (current: EnginePorts) => Promise<OperationResult>): Promise<OperationResult> => {
		if (running) {
			return { kind: 'unavailable', reason: 'busy' };
		}
		running = true;
		let ran = false;
		try {
			const outcome = await guarded(guard, call, { expire: true });
			ran = outcome.ran;
			return outcome.result;
		} finally {
			running = false;
			if (ran) {
				fire();
			}
		}
	};

	/** Runs `checkShared` under the rules of `createEngine`, outside the busy flag. */
	const checkSharedOnce = async (): Promise<OperationResult> => {
		const outcome = await guarded({}, async current => noteChecked(await checkShared(current)), { expire: false });
		if (outcome.ran) {
			fire();
		}
		return outcome.result;
	};

	/**
	 * Applies the refusals of `createEngine` and runs `call`, turning a thrown error into its
	 * result. `ran` is true when `call` started. With `options.expire`, the retention rule runs
	 * after the call.
	 */
	const guarded = async (
		guard: Guard, call: (current: EnginePorts) => Promise<OperationResult>, options: { expire: boolean },
	): Promise<{ result: OperationResult; ran: boolean }> => {
		let ran = false;
		const outcome = (result: OperationResult) => ({ result, ran });
		try {
			const facts = await readFacts();
			if (facts.unusual?.kind === 'git-missing') {
				return outcome({ kind: 'unavailable', reason: 'unusual-state', detail: 'git-missing' });
			}
			if (!facts.isProject) {
				if (!guard.plainFolder) {
					return outcome({ kind: 'unavailable', reason: 'not-tracking' });
				}
			} else {
				const unresolved = await unresolvedRecords();
				if (unresolved.length === 0) {
					unrecovered = undefined;
				}
				if (!guard.resolving) {
					const unusual = facts.unusual?.kind ?? (unrecovered === undefined ? undefined : 'unrecovered');
					if (unusual !== undefined) {
						return outcome({ kind: 'unavailable', reason: 'unusual-state', detail: unusual });
					}
					if (unresolved.length > 0) {
						return outcome({ kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' });
					}
				}
			}
			ran = true;
			const result = await call(ports);
			if (options.expire) {
				try {
					if (await isProjectFolder()) {
						await readFacts();
						await expire(ports);
					}
				} catch (error) {
					// The call's own result stands; the next call applies the retention rule again.
					log(`Expiring old undo entries failed: ${errorText(error)}`);
				}
			}
			return outcome(result);
		} catch (error) {
			if (error instanceof GitTimeoutError) {
				return outcome({ kind: 'unavailable', reason: 'timed-out', detail: error.message });
			}
			if (error instanceof GitMissingError) {
				return outcome({ kind: 'unavailable', reason: 'unusual-state', detail: 'git-missing' });
			}
			log(`A checkpoints action failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
			return outcome({ kind: 'could-not-finish', detail: errorText(error) });
		}
	};

	/** Notes the inputs of a preview: overlaps stay pending while the local and shared commits do not move. */
	const notePreview = async (preview: IncomingPreview | undefined) => {
		if (preview === undefined || preview.overlaps.length === 0) {
			overlapInputs = undefined;
			return;
		}
		overlapInputs = { head: await revision(ports, 'HEAD') ?? '', upstream: await revision(ports, '@{upstream}') ?? '' };
	};

	/** The interrupted action, classified as the project is now (the classification reads only the paths its record names). */
	const describeInterrupted = async (records: JournalRecord[]): Promise<EngineState['interrupted']> => {
		const record = records.find(candidate => candidate.status === 'interrupted');
		if (record === undefined) {
			return undefined;
		}
		const classification = await classify(ports, record);
		return {
			operationId: record.id,
			description: record.description,
			unexpectedPaths: classification.paths.filter(({ part }) => part === 'unexpected').map(({ path: file }) => file),
			indexUnexpected: classification.index === 'unexpected',
		};
	};

	const listEntry = (record: JournalRecord | undefined) => record === undefined ? undefined : {
		operationId: record.id,
		description: record.description,
		kind: record.kind,
		restoresFiles: RESTORES_SNAPSHOT.has(record.kind) || record.paths.length > 0,
	};

	/** The state, with the recovery notice once: the notice is cleared only after the state was built. */
	const getState = async (): Promise<EngineState> => {
		const notice = recoveryNotice;
		const state = await buildState(notice);
		if (recoveryNotice === notice) {
			recoveryNotice = undefined;
		}
		return state;
	};

	const buildState = async (notice: EngineState['recoveryNotice']): Promise<EngineState> => {
		const facts = await readFacts();
		const openedFolder = await fsp.realpath(ports.openedFolder).catch(() => path.resolve(ports.openedFolder));
		const state: EngineState = {
			tracking: facts.isProject ? 'tracking' : 'not-a-project',
			projectName: path.basename(facts.root),
			projectRoot: facts.root,
			openedFolderIsInsideProject: facts.isProject && path.resolve(openedFolder) !== path.resolve(facts.root),
			shared: { exists: facts.upstream !== undefined, ahead: facts.ahead, behind: facts.behind },
			identityMissing: facts.identityMissing,
			syncAvailable: syncAvailable ?? false,
			requiredGitVersion: '2.40',
			pendingOverlap: false,
			recoverySnapshots: [],
			keptFileCount: 0,
		};
		if (notice !== undefined) {
			state.recoveryNotice = notice;
		}
		if (facts.unusual !== undefined) {
			state.unusual = facts.unusual;
		}
		if (!facts.isProject) {
			return state;
		}
		if (facts.branch !== undefined) {
			state.branch = facts.branch;
		}
		if (facts.upstream !== undefined) {
			state.shared.name = facts.upstream;
			const checked = lastChecked ?? await fetchTime(facts.gitDir);
			if (checked !== undefined) {
				state.shared.lastChecked = checked;
			}
		}
		const records = await readRecords(ports);
		if (!records.some(record => record.status === 'prepared' || record.status === 'interrupted')) {
			unrecovered = undefined;
		}
		if (state.unusual === undefined && unrecovered !== undefined) {
			state.unusual = { kind: 'unrecovered', detail: unrecovered };
		}
		if (overlapInputs !== undefined) {
			const now = { head: await revision(ports, 'HEAD') ?? '', upstream: await revision(ports, '@{upstream}') ?? '' };
			state.pendingOverlap = now.head === overlapInputs.head && now.upstream === overlapInputs.upstream;
		}
		const pendingApproval = await readPendingApproval(ports);
		if (pendingApproval !== undefined) {
			state.pendingApproval = pendingApproval;
		}
		const described = await describeInterrupted(records);
		if (described !== undefined) {
			state.interrupted = described;
		}
		state.recoverySnapshots = await listRecoverySnapshots(ports);
		const undoEntry = listEntry(await undoHead(ports));
		if (undoEntry !== undefined) {
			state.undo = undoEntry;
		}
		const redoEntry = listEntry(await redoHead(ports));
		if (redoEntry !== undefined) {
			state.redo = redoEntry;
		}
		state.keptFileCount = (await listKept(ports)).length;
		return state;
	};

	/** The time git last fetched (the time of `FETCH_HEAD`), when it has. */
	const fetchTime = async (gitDir: string): Promise<string | undefined> => {
		const info = await ports.files.lstat(`${gitDir}/FETCH_HEAD`);
		return info === undefined ? undefined : new Date(info.mtimeMs).toISOString();
	};

	/** Runs a read call in a project, or returns `empty` in a plain folder. Rejects as `reading` does. */
	const read = <T>(empty: T, call: (current: EnginePorts) => Promise<T>): Promise<T> => reading(async () => {
		// `runGit` throws for a time-out and a missing git program, which `reading` reports.
		if ((await runGit(ports.git, ['-C', ports.openedFolder, 'rev-parse', '--show-toplevel'])).exitCode !== 0) {
			return empty;
		}
		await readFacts();
		return call(ports);
	});

	const noteChecked = (result: OperationResult) => {
		if (result.kind === 'done') {
			lastChecked = ports.now().toISOString();
		}
		return result;
	};

	// Startup recovery, before any request is served.
	if (await isProjectFolder()) {
		await readFacts();
		try {
			const outcome = await recoverOnStart(ports);
			recoveryNotice = outcome.notice;
			unrecovered = outcome.unrecovered;
		} catch (error) {
			log(`Startup recovery failed: ${errorText(error)}`);
			unrecovered = `Startup recovery stopped: ${errorText(error)}.`;
		}
		try {
			await repairConnect(ports);
		} catch (error) {
			log(`Removing the remote of an unfinished connection failed: ${errorText(error)}`);
		}
		try {
			// Also expires the entries that a send which could not take the lock left pending.
			await expire(ports);
		} catch (error) {
			log(`Expiring old undo entries failed: ${errorText(error)}`);
		}
	}

	const emptyChanges: ChangeSet = { basis: '', files: [] };
	const emptyPreview: IncomingPreview = { basis: '', incoming: [], changedPaths: [], touchesLocalWork: false, overlaps: [], collisions: [] };

	return {
		getState: () => reading(getState),
		getHistory: (skip, limit) => read([], current => getHistory(current, skip, limit)),
		getChanges: () => read(emptyChanges, readChanges),
		getCheckpointFiles: id => read([], current => getCheckpointFiles(current, id)),
		getPendingFiles: token => read([], current => getPendingFiles(current, token)),
		getDiff: target => read({ left: { kind: 'empty' }, right: { kind: 'empty' } }, current => getDiff(current, target)),
		readBlob: oid => reading(async () => {
			await readFacts();
			return readBlob(ports, oid);
		}),
		createCheckpoints: (basis, chunks) => mutate({}, current => createCheckpoints(current, basis, chunks)),
		acceptCheckedCheckpoint: token => mutate({}, current => acceptCheckedCheckpoint(current, token)),
		declineCheckedCheckpoint: token => mutate({}, current => declineCheckedCheckpoint(current, token)),
		editDescription: (id, title, body) => mutate({}, current => editDescription(current, id, title, body)),
		reverseCheckpoint: id => mutate({}, current => reverseCheckpoint(current, id)),
		checkShared: () => {
			if (checking === undefined) {
				checking = checkSharedOnce().finally(() => {
					checking = undefined;
				});
			}
			return checking;
		},
		previewIncoming: () => read(emptyPreview, async current => {
			if (!syncAvailable) {
				return emptyPreview;
			}
			const preview = await previewIncoming(current);
			await notePreview(preview);
			return preview;
		}),
		getIncoming: (basis, resolutions, collisionChoices) => mutate({}, async current => {
			const result = await getIncoming(current, basis, resolutions, collisionChoices);
			if (result.kind === 'overlaps' || result.kind === 'inputs-changed') {
				await notePreview(result.preview);
			} else if (result.kind === 'done') {
				overlapInputs = undefined;
			}
			return result;
		}),
		sendChanges: () => mutate({}, async current => noteChecked(await sendChanges(current))),
		goBackTo: (id, collisionChoices) => mutate({}, current => goBackTo(current, id, collisionChoices)),
		undo: (operationId, collisionChoices) => mutate({}, current => undo(current, operationId, collisionChoices)),
		redo: (operationId, collisionChoices) => mutate({}, current => redo(current, operationId, collisionChoices)),
		getKeptFiles: () => read([], listKept),
		restoreKeptFile: (id, destination) => mutate({}, current => restoreKept(current, id, destination)),
		deleteKeptFile: id => mutate({}, current => deleteKept(current, id)),
		resolveInterrupted: choice => mutate({ resolving: true }, current => resolveInterrupted(current, choice)),
		removeRecoverySnapshot: async operationId => {
			const result = await mutate({ resolving: true }, async current => {
				if ((await unresolvedRecords()).some(record => record.id === operationId)) {
					return { kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' };
				}
				await removeRecoverySnapshot(current, operationId);
				return { kind: 'done', operationId, hookEditedFiles: [] };
			});
			if (result.kind !== 'done') {
				throw new Error(`The recovery snapshot was not removed: ${result.kind === 'unavailable' ? result.reason : result.kind}`);
			}
		},
		startTracking: (identity, gitignore) => mutate({ plainFolder: true }, current => startTracking(current, identity, gitignore)),
		proposedGitignore: () => proposedGitignore(ports),
		connectSharedCopy: url => mutate({}, async current => noteChecked(await connectSharedCopy(current, url))),
		onDidChangeState: listener => {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		notifyChanged: fire,
		dispose: () => listeners.clear(),
	};
}

/**
 * Runs a read call. A git call that outlived its time limit rejects with an `Error` whose message
 * is `checkpoints:timed-out: <detail>`, and a git program that cannot start with
 * `checkpoints:git-missing: <detail>`. Any other failure rejects with its own error.
 */
async function reading<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (error) {
		if (error instanceof GitTimeoutError) {
			throw new Error(`checkpoints:timed-out: ${error.message}`);
		}
		if (error instanceof GitMissingError) {
			throw new Error(`checkpoints:git-missing: ${error.detail}`);
		}
		throw error;
	}
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
