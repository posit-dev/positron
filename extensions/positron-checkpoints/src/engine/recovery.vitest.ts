/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import { acquireLock, engineDirectory, JournalRecord, readRecords, writeRecord } from './journal';
import { EnginePorts, GitRunner } from './ports';
import { listRecoverySnapshots, recoverOnStart, removeRecoverySnapshot, resolveInterrupted } from './recovery';
import { runOperation } from './runOperation';
import { EngineStopped, faultPorts } from './test/faultPorts';
import {
	must, projectState, REF_CHANGE_CALLS, refChangeProject, referenceProject, refExists, refState, SECTION_AFTER, sectionProject, sectionState,
} from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { RECOVERY_REF_PREFIX, SNAPSHOT_REF_PREFIX } from './trees';

type ProjectState = Awaited<ReturnType<typeof projectState>>;

/** Removes the lock a crashed run left behind, as a lock whose process has exited is taken over. */
async function forgetLock(repo: TempRepo): Promise<void> {
	await fsp.rm(`${await engineDirectory(repo.ports)}/lock`, { force: true });
}

/**
 * The project state after the reference operation finished, measured on a separate repository.
 * Its branch commit has another time, so a test compares the branch with its own record.
 */
async function finishedState(): Promise<ProjectState> {
	const repo = await tempRepo();
	try {
		const { plan } = await referenceProject(repo);
		const result = await runOperation(repo.ports, plan);
		if (result.kind !== 'done') {
			throw new Error(`the reference operation did not finish: ${JSON.stringify(result)}`);
		}
		return await projectState(repo);
	} finally {
		await repo.dispose();
	}
}

/** The mutating calls of the reference operation and the state it ends in, measured once. */
const { referenceCalls, after } = await (async () => {
	const repo = await tempRepo();
	try {
		const { plan } = await referenceProject(repo);
		const ports = faultPorts(repo.ports, {});
		await runOperation(ports, plan);
		return { referenceCalls: ports.mutatingCalls, after: await finishedState() };
	} finally {
		await repo.dispose();
	}
})();
const branchMove = referenceCalls.indexOf('update-ref refs/heads/main') + 1;
const crashPoints = Array.from({ length: branchMove }, (_, index) => index + 1);

/**
 * Runs the reference operation in `repo` with a crash at the first mutating call that matches
 * `label` (or at call number `label`), and forgets the crashed run's lock. Returns the state
 * before the operation and the record the crash left.
 */
async function crash(repo: TempRepo, label: RegExp | number): Promise<{ before: ProjectState; a: string; record: JournalRecord | undefined }> {
	const stopAt = typeof label === 'number' ? label : referenceCalls.findIndex(call => label.test(call)) + 1;
	expect(stopAt).toBeGreaterThan(0);
	const { a, plan } = await referenceProject(repo);
	const before = await projectState(repo);
	// The run returns once every call fails; what it leaves on disk is what a crash leaves.
	await runOperation(faultPorts(repo.ports, { stopAt }), plan);
	await forgetLock(repo);
	const [record] = await readRecords(repo.ports);
	return { before, a, record };
}

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('recoverOnStart', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('the crash points end with the branch move', () => {
		expect(branchMove).toBeGreaterThan(5);
	});

	test.each(crashPoints)('crash at mutating call %i with no outside change recovers automatically', async stopAt => {
		const repo = await create();
		const { before, record } = await crash(repo, stopAt);

		const outcome = await recoverOnStart(repo.ports);

		const now = await projectState(repo);
		if (record === undefined) {
			// The crash came before the record was written, so nothing visible had changed.
			expect(outcome).toEqual({});
			expect(now).toEqual(before);
			return;
		}
		expect(outcome.interrupted).toBeUndefined();
		expect(outcome.unrecovered).toBeUndefined();
		if (outcome.notice === 'reversed') {
			expect(now).toEqual(before);
			expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
		} else {
			expect(outcome.notice).toBe('completed');
			expect(now).toEqual({ ...after, branch: record.after.branchCommit });
			expect((await readRecords(repo.ports))[0].status).toBe('complete');
		}
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/backup/${record.id}`).catch(() => undefined)).toBeUndefined();
	});

	test('a crash after the branch moved completes the operation', async () => {
		const repo = await create();
		const { b, plan } = await referenceProject(repo);
		// Every call fails from the moment the record would be marked complete.
		let stopped = false;
		const gate = () => {
			if (stopped) {
				throw new EngineStopped();
			}
		};
		const crashing: EnginePorts = {
			...repo.ports,
			git: async (args, options) => { gate(); return repo.ports.git(args, options); },
			files: {
				...repo.ports.files,
				appendDurable: async (file, line) => {
					gate();
					if (line.includes('"status":"complete"')) {
						stopped = true;
						throw new EngineStopped();
					}
					return repo.ports.files.appendDurable(file, line);
				},
				move: async (from, to) => { gate(); return repo.ports.files.move(from, to); },
				remove: async file => { gate(); return repo.ports.files.remove(file); },
			},
		};
		await runOperation(crashing, plan).catch(() => undefined);
		await forgetLock(repo);
		expect((await readRecords(repo.ports))[0].status).toBe('prepared');

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'completed' });
		expect(await projectState(repo)).toEqual({ ...after, branch: b });
		expect((await readRecords(repo.ports))[0].status).toBe('complete');
	});

	test('recovery snapshot exists before any write', async () => {
		const repo = await create();
		await crash(repo, /^move \.a\.txt\./);
		const ports = faultPorts(repo.ports, {});

		expect(await recoverOnStart(ports)).toEqual({ notice: 'reversed' });

		const saved = ports.mutatingCalls.indexOf(`update-ref ${RECOVERY_REF_PREFIX}op-1`);
		expect(saved).toBeGreaterThanOrEqual(0);
		// Before it, only the snapshot's own temporary index files are removed.
		for (const call of ports.mutatingCalls.slice(0, saved)) {
			expect(call).toMatch(/^remove .*\/positron-checkpoints\/tmp\/index-/);
		}
		expect(ports.mutatingCalls.length).toBeGreaterThan(saved + 1);
	});

	test('a file in the record edited after the crash blocks automatic recovery', async () => {
		const repo = await create();
		await crash(repo, /^update-ref refs\/heads\/main$/);
		await repo.write('a.txt', 'edited after the crash\n');
		const found = await projectState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome).toEqual({ interrupted: { operationId: 'op-1', description: 'Go back', unexpectedPaths: ['a.txt'], indexUnexpected: false } });
		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(true);
	});

	test('work staged after the crash blocks automatic recovery', async () => {
		const repo = await create();
		await crash(repo, /^update-ref refs\/heads\/main$/);
		const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: 'staged after the crash\n' });
		await must(repo, ['update-index', '--cacheinfo', `100644,${blob},c.txt`]);
		const found = await projectState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome).toEqual({ interrupted: { operationId: 'op-1', description: 'Go back', unexpectedPaths: [], indexUnexpected: true } });
		expect(await projectState(repo)).toEqual(found);
	});

	test('a file outside the record edited after the crash does not block recovery and is untouched', async () => {
		const repo = await create();
		const { before } = await crash(repo, /^update-ref refs\/heads\/main$/);
		await repo.write('c.txt', 'edited after the crash\n');
		await repo.write('u.txt', 'untracked, edited after the crash\n');

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'reversed' });

		expect(await repo.read('c.txt')).toBe('edited after the crash\n');
		expect(await repo.read('u.txt')).toBe('untracked, edited after the crash\n');
		const now = await projectState(repo);
		expect({ ...now, worktree: undefined }).toEqual({ ...before, worktree: undefined });
	});

	test('a lock held by a running window leaves the record for that window', async () => {
		const repo = await create();
		const { record } = await crash(repo, /^update-ref refs\/heads\/main$/);
		const found = await projectState(repo);
		const lock = await acquireLock(repo.ports);

		expect(await recoverOnStart(repo.ports)).toEqual({});

		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe(record!.status);
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(false);
		await lock!.release();
	});

	test('branch at neither commit reports unrecovered with both ref names', async () => {
		const repo = await create();
		const { a } = await crash(repo, /^update-ref refs\/heads\/main$/);
		const elsewhere = await must(repo, ['commit-tree', `${a}^{tree}`, '-p', a, '-m', 'Elsewhere']);
		await must(repo, ['update-ref', 'refs/heads/main', elsewhere]);
		const found = await projectState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome.notice).toBeUndefined();
		expect(outcome.interrupted).toBeUndefined();
		expect(outcome.unrecovered).toContain(`${SNAPSHOT_REF_PREFIX}op-1`);
		expect(outcome.unrecovered).toContain(`${RECOVERY_REF_PREFIX}op-1`);
		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('prepared');
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(true);
	});

	test('an interrupted record from a failed live reversal is reported and resolved like a crash record', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		let failing = false;
		const git: GitRunner = async (args, options) => {
			if (args.includes('update-ref') && args.includes('refs/heads/main')) {
				failing = true;
				throw new Error('injected branch failure');
			}
			return repo.ports.git(args, options);
		};
		const ports: EnginePorts = {
			...repo.ports,
			git,
			files: {
				...repo.ports.files,
				move: async (from, to) => {
					if (failing) {
						throw new Error('injected move failure');
					}
					return repo.ports.files.move(from, to);
				},
			},
		};
		expect(await runOperation(ports, plan)).toEqual({ kind: 'interrupted' });
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(false);
		const found = await projectState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome).toEqual({ interrupted: { operationId: 'op-1', description: 'Go back', unexpectedPaths: [], indexUnexpected: false } });
		expect(await projectState(repo)).toEqual(found);
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(true);
		expect(await resolveInterrupted(repo.ports, 'reverse-keep-newer')).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: [] });
		expect(await projectState(repo)).toEqual(before);
	});
	test('an interrupted record whose branch is at neither commit reports unrecovered', async () => {
		const repo = await create();
		// A crash before the branch step, so the engine never moved the branch.
		const { a } = await crash(repo, /^read-tree /);
		await repo.write('a.txt', 'edited after the crash\n');
		expect((await recoverOnStart(repo.ports)).interrupted).toBeDefined();
		expect((await readRecords(repo.ports))[0].progress.some(entry => entry.step === 'branch')).toBe(false);
		await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', `${a}^{tree}`, '-p', a, '-m', 'Elsewhere'])]);
		const found = await projectState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome.interrupted).toBeUndefined();
		expect(outcome.unrecovered).toContain(`${RECOVERY_REF_PREFIX}op-1`);
		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
	});

	test('a backup folder a crash left behind a decided record is removed, and one of an interrupted record is kept', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		expect((await runOperation(repo.ports, plan)).kind).toBe('done');
		const engine = await engineDirectory(repo.ports);
		await fsp.mkdir(`${engine}/backup/op-1`, { recursive: true });
		await fsp.writeFile(`${engine}/backup/op-1/a.txt`, 'one\n');
		await writeRecord(repo.ports, { ...(await readRecords(repo.ports))[0], id: 'op-9', status: 'interrupted' });
		await fsp.mkdir(`${engine}/backup/op-9`, { recursive: true });
		await fsp.writeFile(`${engine}/backup/op-9/a.txt`, 'one\n');

		await recoverOnStart(repo.ports);

		expect(await fsp.stat(`${engine}/backup/op-1`).catch(() => undefined)).toBeUndefined();
		expect(await fsp.readFile(`${engine}/backup/op-9/a.txt`, 'utf8')).toBe('one\n');
	});

	test('a record waiting for approval needs no recovery and is left as it is', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const found = await projectState(repo);
		await writeRecord(repo.ports, {
			id: 'pending', kind: 'create-checkpoints', description: 'Create', time: '2026-01-01T00:00:00.000Z', branch: 'main',
			before: plan.expected, after: plan.after, paths: [], skipped: [], keptMoves: [], progress: [], status: 'pending-approval',
		});

		expect(await recoverOnStart(repo.ports)).toEqual({});

		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('pending-approval');
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}pending`)).toBe(false);
	});
});

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('resolveInterrupted', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** A crash after the index step, then an edit of a.txt, which recovery reports as interrupted. */
	const interruptedProject = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		const { before } = await crash(repo, /^update-ref refs\/heads\/main$/);
		await repo.write('a.txt', 'edited after the crash\n');
		expect((await recoverOnStart(repo.ports)).interrupted).toBeDefined();
		return { repo, before };
	};

	test('reverse-keep-newer restores other paths and leaves the edited file byte for byte', async () => {
		const { repo, before } = await interruptedProject();

		expect(await resolveInterrupted(repo.ports, 'reverse-keep-newer')).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: [] });

		expect(await repo.read('a.txt')).toBe('edited after the crash\n');
		expect(await repo.read('b.txt')).toBe('bee\n');
		const now = await projectState(repo);
		expect({ ...now, worktree: undefined }).toEqual({ ...before, worktree: undefined });
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(true);
	});

	test('leave-as-is changes nothing and marks the record abandoned', async () => {
		const { repo } = await interruptedProject();
		const found = await projectState(repo);

		expect(await resolveInterrupted(repo.ports, 'leave-as-is')).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: [] });

		expect(await projectState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('abandoned');
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(true);
	});

	test('with nothing interrupted it is unavailable', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await referenceProject(repo);
		expect(await resolveInterrupted(repo.ports, 'leave-as-is')).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
	});

	test('listRecoverySnapshots lists each recovery ref with its time, and removeRecoverySnapshot removes one', async () => {
		const { repo } = await interruptedProject();

		expect(await listRecoverySnapshots(repo.ports)).toEqual([{ operationId: 'op-1', time: '2026-01-01T00:00:00.000Z' }]);

		await removeRecoverySnapshot(repo.ports, 'op-1');
		expect(await listRecoverySnapshots(repo.ports)).toEqual([]);
		expect(await refExists(repo, `${RECOVERY_REF_PREFIX}op-1`)).toBe(false);
	});
});

/** The mutating calls of the `refChangeProject` operation, measured once. */
const refChangeCalls = await (async () => {
	const repo = await tempRepo();
	try {
		const { plan } = await refChangeProject(repo);
		const ports = faultPorts(repo.ports, {});
		await runOperation(ports, plan);
		return ports.mutatingCalls;
	} finally {
		await repo.dispose();
	}
})();

/** Runs the `refChangeProject` operation with a crash at the mutating call of change `index`, and forgets the crashed run's lock. */
async function crashAtChange(repo: TempRepo, index: number) {
	const stopAt = refChangeCalls.findIndex(call => REF_CHANGE_CALLS[index].test(call)) + 1;
	expect(stopAt).toBeGreaterThan(0);
	const project = await refChangeProject(repo);
	const before = await refState(repo);
	expect(await runOperation(faultPorts(repo.ports, { stopAt }), project.plan)).toEqual({ kind: 'interrupted' });
	await forgetLock(repo);
	expect((await readRecords(repo.ports))[0].status).toBe('prepared');
	return { ...project, before };
}

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('recoverOnStart with ref changes', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test.each([0, 1, 2, 3])('recovery reverses a record that stopped before the commit point (change %i)', async index => {
		const repo = await create();
		const { before } = await crashAtChange(repo, index);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'reversed' });

		expect(await refState(repo)).toEqual(before);
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('recovery completes a record that stopped after the commit point', async () => {
		const repo = await create();
		const { a, c, before } = await crashAtChange(repo, 4);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'completed' });

		expect(await refState(repo)).toEqual({
			...before, head: 'refs/heads/proposal/x', main: a, proposal: c,
			config: 'branch.proposal/x.positroncheckpointsbase main\n', engineFile: '{"branch":"main"}\n',
		});
		expect((await readRecords(repo.ports))[0].status).toBe('complete');
	});

	test('work staged after a crash after the commit point stays staged, and the record is completed', async () => {
		const repo = await create();
		const { a, c, before } = await crashAtChange(repo, 4);
		await must(repo, ['add', 'a.txt']);
		const staged = await must(repo, ['write-tree']);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'completed' });

		expect(await refState(repo)).toEqual({
			...before, head: 'refs/heads/proposal/x', main: a, proposal: c,
			config: 'branch.proposal/x.positroncheckpointsbase main\n', engineFile: '{"branch":"main"}\n', index: staged,
		});
		expect((await readRecords(repo.ports))[0].status).toBe('complete');
	});

	test('work staged after a crash before the commit point stays staged, and the record is reversed', async () => {
		const repo = await create();
		const { before } = await crashAtChange(repo, 2);
		await must(repo, ['add', 'a.txt']);
		const staged = await must(repo, ['write-tree']);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'reversed' });

		expect(await refState(repo)).toEqual({ ...before, index: staged });
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('a ref another tool moved after a crash before the commit point makes the record interrupted, and writes nothing', async () => {
		const repo = await create();
		const { a } = await crashAtChange(repo, 3);
		// Another tool makes the proposal branch point elsewhere, as a commit on it would.
		await must(repo, ['update-ref', 'refs/heads/proposal/x', a]);
		const found = await refState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome).toEqual({ interrupted: { operationId: 'op-1', description: 'Change several refs', unexpectedPaths: [], indexUnexpected: false } });
		expect(await refState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');

		// Reversal keeps the moved ref and undoes the rest.
		expect((await resolveInterrupted(repo.ports, 'reverse-keep-newer')).kind).toBe('done');
		expect(await refState(repo)).toEqual({ ...found, head: 'refs/heads/main', config: '' });
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('a change at the commit point that another tool moved leaves the record unrecovered and writes nothing', async () => {
		const repo = await create();
		const { c } = await crashAtChange(repo, 4);
		// A commit that does not descend from the change's after commit.
		const other = await must(repo, ['commit-tree', `${c}^{tree}`, '-m', 'other']);
		await must(repo, ['update-ref', 'refs/heads/main', other]);
		const found = await refState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome.unrecovered).toContain(`${RECOVERY_REF_PREFIX}op-1`);
		expect(await refState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('prepared');
	});

	test('a change before the commit point that another tool put back after the crash makes the record interrupted, and writes nothing', async () => {
		const repo = await create();
		await crashAtChange(repo, 4);
		// The person switches back to main, which puts change 2 back to its before value.
		await must(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
		const found = await refState(repo);

		const outcome = await recoverOnStart(repo.ports);

		expect(outcome.interrupted?.operationId).toBe('op-1');
		expect(await refState(repo)).toEqual(found);
		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
	});
});

/** The mutating calls of the `sectionProject` operation, measured once. */
const sectionCalls = await (async () => {
	const repo = await tempRepo();
	try {
		const { plan } = await sectionProject(repo);
		const ports = faultPorts(repo.ports, {});
		await runOperation(ports, plan);
		return ports.mutatingCalls;
	} finally {
		await repo.dispose();
	}
})();
/** The call numbers of the mutating calls that write the section `section`. */
const sectionWrites = (section: string) => sectionCalls
	.map((call, index) => call === `config ${section}` || call.startsWith(`config ${section}.`) ? index + 1 : 0)
	.filter(number => number > 0);

describe('recoverOnStart with configuration sections that have keys', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** Runs the `sectionProject` operation with a crash at mutating call `stopAt`, and forgets the crashed run's lock. */
	const crashAt = async (repo: TempRepo, stopAt: number) => {
		const project = await sectionProject(repo);
		const before = await sectionState(repo);
		expect(await runOperation(faultPorts(repo.ports, { stopAt }), project.plan)).toEqual({ kind: 'interrupted' });
		await forgetLock(repo);
		return { ...project, before };
	};

	test('each section write is a separate mutating call', () => {
		expect(sectionWrites('branch.proposal/x')).toHaveLength(4);
		expect(sectionWrites('branch.side')).toHaveLength(4);
	});

	test.each(sectionWrites('branch.proposal/x'))('a crash at call %i of a section before the commit point is reversed to the whole section before', async stopAt => {
		const repo = await create();
		const { before } = await crashAt(repo, stopAt);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'reversed' });

		expect(await sectionState(repo)).toEqual(before);
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test.each(sectionWrites('branch.side'))('a crash at call %i of a section after the commit point is completed to the whole section after', async stopAt => {
		const repo = await create();
		const { c, before } = await crashAt(repo, stopAt);

		expect(await recoverOnStart(repo.ports)).toEqual({ notice: 'completed' });

		expect(await sectionState(repo)).toEqual({ ...before, config: SECTION_AFTER, proposal: c });
		expect((await readRecords(repo.ports))[0].status).toBe('complete');
	});
});
