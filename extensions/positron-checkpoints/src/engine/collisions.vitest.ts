/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { deleteKept, findCollisions, listKept, restoreKept } from './collisions';
import { engineDirectory, PathPlan, readRecords } from './journal';
import { EnginePorts } from './ports';
import { OperationPlan, runOperation } from './runOperation';
import { recoverOnStart } from './recovery';
import { faultPorts } from './test/faultPorts';
import { afterJournal, collidingProject, currentState, folderCollidingProject, must, projectState, refExists, treeWith } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES, SNAPSHOT_REF_PREFIX, worktreeTree } from './trees';

/** A plan that creates `file` with some content. */
function incoming(file: string): PathPlan {
	return { path: file, before: null, after: '0123456789012345678901234567890123456789', beforeMode: null, afterMode: '100644' };
}

// Each test runs git several times, which can exceed the default limit under a loaded test run.
describe('findCollisions', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('.gitignore', '*.log\n');
		await repo.write('a.txt', 'one\n');
		await repo.commit('A');
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('an incoming file at the path of an ignored local file is a collision', async () => {
		const repo = await create();
		await repo.write('debug.log', 'mine\n');
		expect(await findCollisions(repo.ports, [incoming('debug.log'), incoming('new.txt')], [])).toEqual([
			{ path: 'debug.log', reason: 'ignored', sizeBytes: 5 },
		]);
	});

	test('an incoming file at the path of a skipped large file is a collision', async () => {
		const repo = await create();
		const big = path.join(repo.root, 'big.bin');
		await fsp.writeFile(big, '');
		await fsp.truncate(big, LARGE_FILE_BYTES + 1);
		const { skipped } = await worktreeTree(repo.ports);
		expect(skipped).toEqual(['big.bin']);
		expect(await findCollisions(repo.ports, [incoming('big.bin')], skipped)).toEqual([
			{ path: 'big.bin', reason: 'too-large', sizeBytes: LARGE_FILE_BYTES + 1 },
		]);
	});

	test('an incoming file where a directory with an ignored file exists is a collision', async () => {
		const repo = await create();
		await repo.write('out/run.log', 'mine\n');
		await repo.write('out/deep/trace.log', 'deeper\n');
		expect(await findCollisions(repo.ports, [incoming('out')], [])).toEqual([
			{ path: 'out/deep/trace.log', reason: 'ignored', sizeBytes: 7 },
			{ path: 'out/run.log', reason: 'ignored', sizeBytes: 5 },
		]);
	});

	test('an incoming folder where an ignored file exists is a collision', async () => {
		const repo = await create();
		await repo.write('notes.log', 'mine\n');
		expect(await findCollisions(repo.ports, [incoming('notes.log/inside.txt')], [])).toEqual([
			{ path: 'notes.log', reason: 'ignored', sizeBytes: 5 },
		]);
	});

	test('an untracked file inside the snapshot is not a collision', async () => {
		const repo = await create();
		await repo.write('u.txt', 'untracked\n');
		await repo.write('other.log', 'ignored, elsewhere\n');
		await repo.write('dir/other.log', 'ignored, elsewhere\n');
		expect(await findCollisions(repo.ports, [incoming('u.txt'), incoming('dir/new.txt')], [])).toEqual([]);
	});

	test('a file the plan removes is not a collision', async () => {
		const repo = await create();
		await repo.write('debug.log', 'mine\n');
		expect(await findCollisions(repo.ports, [{ ...incoming('debug.log'), before: incoming('x').after, after: null, beforeMode: '100644', afterMode: null }], [])).toEqual([]);
	});

	// Review Focus 1.
	test('on a case-insensitive file system, Data.csv collides with ignored data.csv', async () => {
		const repo = await create();
		await repo.write('.gitignore', '*.log\ndata.csv\n');
		await repo.write('data.csv', 'mine\n');
		const ports: EnginePorts = { ...repo.ports, files: { ...repo.ports.files, caseInsensitive: async () => true } };
		expect(await findCollisions(ports, [incoming('Data.csv')], [])).toEqual([{ path: 'data.csv', reason: 'ignored', sizeBytes: 5 }]);
		const sensitive: EnginePorts = { ...repo.ports, files: { ...repo.ports.files, caseInsensitive: async () => false } };
		expect(await findCollisions(sensitive, [incoming('Data.csv')], [])).toEqual([]);
	});
});

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('runOperation with collisions and kept files', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};
	const keepCopy = [{ path: 'debug.log', choice: 'use-theirs-keep-copy' as const }];
	const keptFile = async (repo: TempRepo, operationId: string, file: string) => `${await engineDirectory(repo.ports)}/kept/${operationId}/${file}`;

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('runOperation with an unanswered collision changes nothing', async () => {
		const repo = await create();
		const { a, plan } = await collidingProject(repo);

		expect(await runOperation(repo.ports, plan)).toEqual({ kind: 'path-collisions', collisions: [{ path: 'debug.log', reason: 'ignored', sizeBytes: 8 }] });

		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(a);
		expect(await currentState(repo)).toEqual(plan.expected);
		expect(await readRecords(repo.ports)).toEqual([]);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}op-1`)).toBe(false);
	});

	test('use-theirs-keep-copy moves the local file and writes the incoming one', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);

		expect(await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: [] });

		expect(await repo.read('debug.log')).toBe('incoming\n');
		expect(await fsp.readFile(await keptFile(repo, 'op-1', 'debug.log'), 'utf8')).toBe('ignored\n');
		expect(await listKept(repo.ports)).toEqual([
			{ id: 'op-1/debug.log', originalPath: 'debug.log', sizeBytes: 8, time: '2026-01-01T00:00:00.000Z', action: 'Go back' },
		]);
		const [record] = await readRecords(repo.ports);
		const move = { from: 'debug.log', to: await keptFile(repo, 'op-1', 'debug.log'), sizeBytes: 8, blob: await must(repo, ['hash-object', '--stdin'], { stdin: 'ignored\n' }) };
		expect(record.keptMoves).toEqual([move]);
		expect(record.progress[0]).toEqual({ step: 'kept', ...move });
	});

	test('a collision inside a directory the plan replaces is moved aside with the folder left empty', async () => {
		const repo = await create();
		await repo.write('.gitignore', '*.log\n');
		await repo.write('a.txt', 'one\n');
		const a = await repo.commit('A');
		await repo.write('out/run.log', 'mine\n');
		const tree = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { out: 'a file now\n' });
		const commit = await must(repo, ['commit-tree', tree, '-p', a, '-m', 'B']);
		const plan: OperationPlan = { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after: { branchCommit: commit, indexTree: tree, worktreeTree: tree }, collisionChoices: [] };

		expect(await runOperation(repo.ports, plan)).toMatchObject({ kind: 'path-collisions', collisions: [{ path: 'out/run.log' }] });
		const result = await runOperation(repo.ports, { ...plan, collisionChoices: [{ path: 'out/run.log', choice: 'use-theirs-keep-copy' }] });

		expect(result.kind).toBe('done');
		expect(await repo.read('out')).toBe('a file now\n');
		expect(await fsp.readFile(await keptFile(repo, 'op-2', 'out/run.log'), 'utf8')).toBe('mine\n');
	});

	test('reverse moves the kept file back', async () => {
		const repo = await create();
		const { a, plan } = await collidingProject(repo);
		const ports = afterJournal(repo.ports, async () => {
			await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', plan.after.indexTree, '-p', a, '-m', 'Elsewhere'])]);
		});

		expect((await runOperation(ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('could-not-finish');

		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await fsp.stat(await keptFile(repo, 'op-1', 'debug.log')).catch(() => undefined)).toBeUndefined();
		expect(await listKept(repo.ports)).toEqual([]);
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('a kept file survives when its journal record is removed', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');

		await fsp.rm(`${await engineDirectory(repo.ports)}/journal.jsonl`);

		expect(await readRecords(repo.ports)).toEqual([]);
		expect(await listKept(repo.ports)).toMatchObject([{ id: 'op-1/debug.log', originalPath: 'debug.log' }]);
		expect(await fsp.readFile(await keptFile(repo, 'op-1', 'debug.log'), 'utf8')).toBe('ignored\n');
	});

	test('restoreKept to the original path and to a chosen path', async () => {
		const repo = await create();
		const { a, plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');

		expect(await restoreKept(repo.ports, 'op-1/debug.log', 'saved/mine.log')).toEqual({ kind: 'done', operationId: 'op-1/debug.log', hookEditedFiles: [] });
		expect(await repo.read('saved/mine.log')).toBe('ignored\n');
		expect(await repo.read('debug.log')).toBe('incoming\n');
		expect(await listKept(repo.ports)).toEqual([]);

		// A second operation keeps the incoming copy aside; with its path free, it goes back there.
		await must(repo, ['reset', '-q', '--hard', a]);
		await repo.write('debug.log', 'second\n');
		const second = await runOperation(repo.ports, { ...plan, expected: await currentState(repo), collisionChoices: keepCopy });
		expect(second).toMatchObject({ kind: 'done', operationId: 'op-2' });
		await fsp.rm(path.join(repo.root, 'debug.log'));

		expect(await restoreKept(repo.ports, 'op-2/debug.log')).toEqual({ kind: 'done', operationId: 'op-2/debug.log', hookEditedFiles: [] });
		expect(await repo.read('debug.log')).toBe('second\n');
		expect(await listKept(repo.ports)).toEqual([]);
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/kept/op-2`).catch(() => undefined)).toBeUndefined();
	});

	test('restoreKept refuses an occupied path without a destination', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');

		expect(await restoreKept(repo.ports, 'op-1/debug.log')).toEqual({ kind: 'unavailable', reason: 'occupied' });
		expect(await restoreKept(repo.ports, 'op-1/debug.log', 'a.txt')).toEqual({ kind: 'unavailable', reason: 'occupied' });

		expect(await repo.read('debug.log')).toBe('incoming\n');
		expect(await repo.read('a.txt')).toBe('two\n');
		expect(await listKept(repo.ports)).toHaveLength(1);
	});

	test('restoreKept never replaces a file created after its check', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');
		await fsp.rm(path.join(repo.root, 'debug.log'));
		// Another tool creates the file just as the kept file is about to be placed there.
		const racing: EnginePorts = {
			...repo.ports,
			files: {
				...repo.ports.files,
				linkOrCopy: async (from, to) => {
					await repo.write('debug.log', 'created meanwhile\n');
					return repo.ports.files.linkOrCopy(from, to);
				},
			},
		};

		expect(await restoreKept(racing, 'op-1/debug.log')).toEqual({ kind: 'unavailable', reason: 'occupied' });

		expect(await repo.read('debug.log')).toBe('created meanwhile\n');
		expect(await fsp.readFile(await keptFile(repo, 'op-1', 'debug.log'), 'utf8')).toBe('ignored\n');
		expect(await listKept(repo.ports)).toHaveLength(1);
	});

	test('a failed deleteKept keeps the entry of a file it could not remove', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');
		const failing: EnginePorts = {
			...repo.ports,
			files: {
				...repo.ports.files,
				remove: async file => {
					if (file.includes('/kept/')) {
						throw new Error('injected removal failure');
					}
					return repo.ports.files.remove(file);
				},
			},
		};

		expect((await deleteKept(failing, 'op-1/debug.log')).kind).toBe('could-not-finish');

		expect(await listKept(repo.ports)).toMatchObject([{ id: 'op-1/debug.log' }]);
	});

	test('deleteKept removes the file and its entry', async () => {
		const repo = await create();
		const { plan } = await collidingProject(repo);
		expect((await runOperation(repo.ports, { ...plan, collisionChoices: keepCopy })).kind).toBe('done');

		expect(await deleteKept(repo.ports, 'op-1/debug.log')).toEqual({ kind: 'done', operationId: 'op-1/debug.log', hookEditedFiles: [] });

		expect(await listKept(repo.ports)).toEqual([]);
		expect(await fsp.stat(await keptFile(repo, 'op-1', 'debug.log')).catch(() => undefined)).toBeUndefined();
		expect(await deleteKept(repo.ports, 'op-1/debug.log')).toEqual({ kind: 'unavailable', reason: 'nothing-to-do' });
	});
});

/**
 * The mutating calls of an operation with a kept move, measured once per project. Every call up
 * to and including the branch move is a crash point.
 */
const crashSweeps = await (async () => {
	const sweeps: { name: string; build: typeof collidingProject; kept: string; keptContent: string; points: number[] }[] = [];
	for (const [name, build, kept, keptContent] of [
		['an ignored file at an incoming path', collidingProject, 'debug.log', 'ignored\n'],
		['an ignored file in a folder the plan replaces', folderCollidingProject, 'out/run.log', 'mine\n'],
	] as const) {
		const repo = await tempRepo();
		try {
			const { plan } = await build(repo);
			const ports = faultPorts(repo.ports, {});
			const result = await runOperation(ports, { ...plan, collisionChoices: [{ path: kept, choice: 'use-theirs-keep-copy' }] });
			if (result.kind !== 'done') {
				throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
			}
			const branchMove = ports.mutatingCalls.indexOf('update-ref refs/heads/main') + 1;
			sweeps.push({ name, build, kept, keptContent, points: Array.from({ length: branchMove }, (_, index) => index + 1) });
		} finally {
			await repo.dispose();
		}
	}
	return sweeps;
})();

// Each test runs full operations, which exceed the default limit under a loaded test run.
describe('recovery after a crash during an operation with a kept move', { timeout: 30_000 }, () => {
	const cases = crashSweeps.flatMap(sweep => sweep.points.map(stopAt => ({ ...sweep, stopAt })));

	test.each(cases)('$name: a crash at mutating call $stopAt recovers automatically and keeps the file', async ({ build, kept, keptContent, stopAt }) => {
		const repo = await tempRepo();
		try {
			const { plan } = await build(repo);
			const before = await projectState(repo);
			await runOperation(faultPorts(repo.ports, { stopAt }), { ...plan, collisionChoices: [{ path: kept, choice: 'use-theirs-keep-copy' }] });
			// The process that held the lock has exited.
			await fsp.rm(`${await engineDirectory(repo.ports)}/lock`, { force: true });
			const [record] = await readRecords(repo.ports);

			const outcome = await recoverOnStart(repo.ports);

			expect(outcome.interrupted).toBeUndefined();
			expect(outcome.unrecovered).toBeUndefined();
			const keptCopy = await fsp.readFile(`${await engineDirectory(repo.ports)}/kept/op-1/${kept}`, 'utf8').catch(() => undefined);
			if (record === undefined || outcome.notice === 'reversed') {
				expect(outcome.notice).toBe(record === undefined ? undefined : 'reversed');
				expect(await projectState(repo)).toEqual(before);
				expect(await repo.read(kept)).toBe(keptContent);
				expect(keptCopy).toBeUndefined();
				expect(await listKept(repo.ports)).toEqual([]);
			} else {
				expect(outcome.notice).toBe('completed');
				expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(plan.after.branchCommit);
				expect(keptCopy).toBe(keptContent);
			}
		} finally {
			await repo.dispose();
		}
	});
});
