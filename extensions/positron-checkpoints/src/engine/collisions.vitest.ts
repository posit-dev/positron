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
import { afterJournal, currentState, must, referenceProject, refExists, treeWith } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES, SNAPSHOT_REF_PREFIX, worktreeTree } from './trees';

/** A plan that creates `file` with some content. */
function incoming(file: string): PathPlan {
	return { path: file, before: null, after: '0123456789012345678901234567890123456789', beforeMode: null, afterMode: '100644' };
}

/**
 * The reference project (with its ignored debug.log, "ignored\n") and a plan whose after state
 * also has an incoming debug.log, "incoming\n".
 */
async function collidingProject(repo: TempRepo): Promise<{ a: string; plan: OperationPlan }> {
	const { a, plan } = await referenceProject(repo);
	const indexTree = await treeWith(repo, plan.after.indexTree, { 'debug.log': 'incoming\n' });
	const branchCommit = await must(repo, ['commit-tree', indexTree, '-p', a, '-m', 'B with debug.log']);
	const worktree = await treeWith(repo, plan.after.worktreeTree, { 'debug.log': 'incoming\n' });
	return { a, plan: { ...plan, after: { branchCommit, indexTree, worktreeTree: worktree } } };
}

describe('findCollisions', () => {
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

describe('runOperation with collisions and kept files', () => {
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
		expect(record.keptMoves).toEqual([{ from: 'debug.log', to: await keptFile(repo, 'op-1', 'debug.log') }]);
		expect(record.progress[0]).toEqual({ step: 'kept', from: 'debug.log', to: await keptFile(repo, 'op-1', 'debug.log') });
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

		expect(await restoreKept(repo.ports, 'op-1/debug.log')).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'occupied' });
		expect(await restoreKept(repo.ports, 'op-1/debug.log', 'a.txt')).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'occupied' });

		expect(await repo.read('debug.log')).toBe('incoming\n');
		expect(await repo.read('a.txt')).toBe('two\n');
		expect(await listKept(repo.ports)).toHaveLength(1);
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
