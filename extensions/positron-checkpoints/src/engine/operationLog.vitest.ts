/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { listKept } from './collisions';
import { engineDirectory, PathPlan, readRecords } from './journal';
import { expire, noteNewOperation, readOperationLog, redo, redoHead, undo, undoHead } from './operationLog';
import { EnginePorts } from './ports';
import { recoverOnStart } from './recovery';
import { runOperation } from './runOperation';
import { faultPorts } from './test/faultPorts';
import { collidingProject, currentState, must, projectState, refExists, treeWith } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { SNAPSHOT_REF_PREFIX } from './trees';
import { OperationKind, OperationResult } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Each test runs several full operations, which exceed the default limit under a loaded test run.
describe('operationLog', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('.gitignore', '*.log\n');
		await repo.write('a.txt', 'one\n');
		await repo.write('b.txt', 'bee\n');
		await repo.commit('A');
		await repo.write('debug.log', 'ignored\n');
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	const doneId = (result: OperationResult): string => {
		if (result.kind !== 'done') {
			throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
		}
		return result.operationId;
	};

	const headTree = (repo: TempRepo) => must(repo, ['rev-parse', 'HEAD^{tree}']);

	/** Records the tracked files with `files` set as a new checkpoint; working files stay as they are. */
	const checkpoint = async (repo: TempRepo, files: Record<string, string | null>, options: { kind?: OperationKind; extraPaths?: PathPlan[] } = {}) => {
		const expected = await currentState(repo);
		const tree = await treeWith(repo, await headTree(repo), files);
		const commit = await must(repo, ['commit-tree', tree, '-p', expected.branchCommit!, '-m', 'checkpoint']);
		return doneId(await runOperation(repo.ports, {
			kind: options.kind ?? 'create-checkpoints', description: 'Create a checkpoint', expected,
			after: { branchCommit: commit, indexTree: tree, worktreeTree: expected.worktreeTree },
			collisionChoices: [], extraPaths: options.extraPaths,
		}));
	};

	/** Brings in a new commit that sets `files`, into the branch, the index, and the working files. */
	const getChanges = async (repo: TempRepo, files: Record<string, string | null>) => {
		const expected = await currentState(repo);
		const tree = await treeWith(repo, await headTree(repo), files);
		const commit = await must(repo, ['commit-tree', tree, '-p', expected.branchCommit!, '-m', 'incoming']);
		return doneId(await runOperation(repo.ports, {
			kind: 'get-changes', description: 'Get changes', expected,
			after: { branchCommit: commit, indexTree: tree, worktreeTree: await treeWith(repo, expected.worktreeTree, files) },
			collisionChoices: [],
		}));
	};

	/** Writes `text` to `file` as a project check would, and returns the path plan of that edit. */
	const hookEdit = async (repo: TempRepo, file: string, text: string): Promise<PathPlan> => {
		const before = await must(repo, ['hash-object', '-w', '--', file]);
		await repo.write(file, text);
		const after = await must(repo, ['hash-object', '-w', '--', file]);
		return { path: file, before, after, beforeMode: '100644', afterMode: '100644' };
	};

	const branch = (repo: TempRepo) => must(repo, ['rev-parse', 'refs/heads/main']);

	test('undo create-checkpoints moves the branch back and leaves working files', async () => {
		const repo = await create();
		const a = await branch(repo);
		await repo.write('a.txt', 'two\n');
		const id = await checkpoint(repo, { 'a.txt': 'two\n' });
		expect(await branch(repo)).not.toBe(a);

		expect((await undo(repo.ports, id, [])).kind).toBe('done');

		expect(await branch(repo)).toBe(a);
		expect(await must(repo, ['write-tree'])).toBe(await headTree(repo));
		expect(await repo.read('a.txt')).toBe('two\n');
		expect((await undoHead(repo.ports))).toBeUndefined();
		expect((await redoHead(repo.ports))?.id).toBe(id);
	});

	test('undo create-checkpoints returns files a project check rewrote, and redo returns the check content', async () => {
		const repo = await create();
		const a = await branch(repo);
		await repo.write('a.txt', 'two\n');
		const edit = await hookEdit(repo, 'b.txt', 'BEE\n');
		const id = await checkpoint(repo, { 'a.txt': 'two\n' }, { extraPaths: [edit] });
		const b = await branch(repo);

		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect([await branch(repo), await repo.read('a.txt'), await repo.read('b.txt')]).toEqual([a, 'two\n', 'bee\n']);

		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		expect([await branch(repo), await repo.read('a.txt'), await repo.read('b.txt')]).toEqual([b, 'two\n', 'BEE\n']);
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('undo check-changed-files returns the rewritten files, and redo returns the check content', async () => {
		const repo = await create();
		const edit = await hookEdit(repo, 'b.txt', 'BEE\n');
		const expected = await currentState(repo);
		const id = doneId(await runOperation(repo.ports, {
			kind: 'check-changed-files', description: 'Project check changed files', expected, after: expected, collisionChoices: [], extraPaths: [edit],
		}));

		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('b.txt')).toBe('bee\n');
		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('b.txt')).toBe('BEE\n');
	});

	test('undo leaves a rewritten file that was edited again after the check', async () => {
		const repo = await create();
		const edit = await hookEdit(repo, 'b.txt', 'BEE\n');
		const id = await checkpoint(repo, {}, { extraPaths: [edit] });
		await repo.write('b.txt', 'mine\n');

		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('b.txt')).toBe('mine\n');
	});

	test('undo get-changes restores files and index', async () => {
		const repo = await create();
		await repo.write('u.txt', 'untracked\n');
		const before = await projectState(repo);
		const id = await getChanges(repo, { 'a.txt': 'theirs\n', 'b.txt': null, 'c.txt': 'new\n' });
		expect(await repo.read('a.txt')).toBe('theirs\n');

		expect((await undo(repo.ports, id, [])).kind).toBe('done');

		expect(await projectState(repo)).toEqual(before);
		expect(await repo.read('b.txt')).toBe('bee\n');
		await expect(fsp.stat(path.join(repo.root, 'c.txt'))).rejects.toThrow();
	});

	test('A, B, undo B, undo A, redo A, redo B returns to the state after B', async () => {
		const repo = await create();
		const start = await projectState(repo);
		const first = await getChanges(repo, { 'a.txt': 'A\n' });
		const afterA = await projectState(repo);
		const second = await getChanges(repo, { 'b.txt': 'B\n', 'c.txt': 'C\n' });
		const afterB = await projectState(repo);

		expect((await undo(repo.ports, second, [])).kind).toBe('done');
		expect(await projectState(repo)).toEqual(afterA);
		expect((await undoHead(repo.ports))?.id).toBe(first);
		expect((await undo(repo.ports, first, [])).kind).toBe('done');
		expect(await projectState(repo)).toEqual(start);
		expect((await redoHead(repo.ports))?.id).toBe(first);
		expect((await redo(repo.ports, first, [])).kind).toBe('done');
		expect(await projectState(repo)).toEqual(afterA);
		expect((await redo(repo.ports, second, [])).kind).toBe('done');

		expect(await projectState(repo)).toEqual(afterB);
		expect((await undoHead(repo.ports))?.id).toBe(second);
		expect(await redoHead(repo.ports)).toBeUndefined();
	});

	test('undo then a new operation clears redo', async () => {
		const repo = await create();
		const first = await getChanges(repo, { 'a.txt': 'A\n' });
		const undone = await getChanges(repo, { 'b.txt': 'B\n' });
		expect((await undo(repo.ports, undone, [])).kind).toBe('done');
		const undoRecord = (await readRecords(repo.ports)).at(-1)!.id;
		const third = await checkpoint(repo, {});
		await noteNewOperation(repo.ports, 'create-checkpoints');

		expect(await redoHead(repo.ports)).toBeUndefined();
		expect((await undoHead(repo.ports))?.id).toBe(third);
		expect((await redo(repo.ports, undone, [])).kind).toBe('unavailable');
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${undone}`)).toBe(false);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${undoRecord}`)).toBe(false);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${first}`)).toBe(true);
		expect((await readOperationLog(repo.ports)).map(entry => [entry.record.id, entry.undone, entry.expired])).toEqual([
			[first, false, false], [undone, false, true], [third, false, false],
		]);
	});

	test('edits made between an operation and its undo return on redo', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'a.txt': 'theirs\n' });
		await repo.write('a.txt', 'theirs\nand mine\n');
		await repo.write('notes.txt', 'new notes\n');

		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('a.txt')).toBe('one\n');
		expect((await redoHead(repo.ports))?.redoWorktreeTree).toBeDefined();
		expect((await redo(repo.ports, id, [])).kind).toBe('done');

		expect(await repo.read('a.txt')).toBe('theirs\nand mine\n');
		expect(await repo.read('notes.txt')).toBe('new notes\n');
	});

	test('undo after redo returns the edits the redo replaced', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'c.txt': 'theirs\n' });
		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		await repo.write('a.txt', 'edited after undo\n');

		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('a.txt')).toBe('one\n');
		expect((await undo(repo.ports, id, [])).kind).toBe('done');

		expect(await repo.read('a.txt')).toBe('edited after undo\n');
		await expect(fsp.stat(path.join(repo.root, 'c.txt'))).rejects.toThrow();
	});

	test('undo, redo, undo, redo with an edit before each step returns every edit at its step', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'c.txt': 'theirs\n' });
		const step = async (edit: string, action: typeof undo) => {
			await repo.write('a.txt', `${edit}\n`);
			expect((await action(repo.ports, id, [])).kind).toBe('done');
			return [await repo.read('a.txt'), await repo.read('c.txt').catch(() => null)];
		};

		expect(await step('e1', undo)).toEqual(['one\n', null]);
		expect(await step('e2', redo)).toEqual(['e1\n', 'theirs\n']);
		expect(await step('e3', undo)).toEqual(['e2\n', null]);
		expect(await step('e4', redo)).toEqual(['e3\n', 'theirs\n']);
		expect(await step('e5', undo)).toEqual(['e4\n', null]);
	});

	test('the snapshot of the latest redo is kept while its entry is on the undo list', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'c.txt': 'theirs\n' });
		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		await repo.write('a.txt', 'edited after undo\n');
		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		const redoRecord = (await readRecords(repo.ports)).at(-1)!;
		expect(redoRecord.role).toEqual({ kind: 'redo', target: id });
		repo.clock.advance(10 * DAY_MS);
		await checkpoint(repo, {});
		await noteNewOperation(repo.ports, 'create-checkpoints');
		await expire(repo.ports);

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${redoRecord.id}`)).toBe(true);
	});

	test('redo of a checkpoint keeps work staged after the undo left it in place', async () => {
		const repo = await create();
		await repo.write('a.txt', 'two\n');
		const id = await checkpoint(repo, { 'a.txt': 'two\n' });
		await repo.write('b.txt', 'staged elsewhere\n');
		await must(repo, ['add', 'b.txt']);
		const staged = await must(repo, ['write-tree']);

		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect(await must(repo, ['write-tree'])).toBe(staged);
		expect((await redo(repo.ports, id, [])).kind).toBe('done');

		expect(await must(repo, ['write-tree'])).toBe(staged);
	});

	test('kept files return inside the undo, and a return that failed is finished at startup', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		const { plan } = await collidingProject(repo);
		const id = doneId(await runOperation(repo.ports, { ...plan, collisionChoices: [{ path: 'debug.log', choice: 'use-theirs-keep-copy' }] }));
		let failed = false;
		const failingReturn: EnginePorts = {
			...repo.ports,
			files: {
				...repo.ports.files,
				linkOrCopy: async (from, to) => {
					if (!failed && from.includes('/kept/')) {
						failed = true;
						throw new Error('injected');
					}
					return repo.ports.files.linkOrCopy(from, to);
				},
			},
		};

		expect((await undo(failingReturn, id, [])).kind).toBe('done');
		expect(failed).toBe(true);
		await expect(fsp.stat(path.join(repo.root, 'debug.log'))).rejects.toThrow();
		expect(await listKept(repo.ports)).toHaveLength(1);

		await recoverOnStart(repo.ports);

		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await listKept(repo.ports)).toEqual([]);
		expect((await readRecords(repo.ports)).at(-1)!.progress.at(-1)).toEqual({ step: 'kept-returned' });
	});

	test('a kept file returned by an undo is recorded inside the operation', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		const { plan } = await collidingProject(repo);
		const id = doneId(await runOperation(repo.ports, { ...plan, collisionChoices: [{ path: 'debug.log', choice: 'use-theirs-keep-copy' }] }));
		const ports = faultPorts(repo.ports, {});

		expect((await undo(ports, id, [])).kind).toBe('done');

		// The file moves back before the lock is released.
		const calls = ports.mutatingCalls;
		expect(calls.findIndex(call => /^linkOrCopy .*\/kept\//.test(call))).toBeLessThan(calls.findIndex(call => /^remove .*\/positron-checkpoints\/lock$/.test(call)));
		expect(await repo.read('debug.log')).toBe('ignored\n');
	});

	test('an entry whose snapshot ref is gone is not offered, even with an unreadable state file', async () => {
		const repo = await create();
		const first = await getChanges(repo, { 'a.txt': 'A\n' });
		const second = await getChanges(repo, { 'a.txt': 'B\n' });
		await fsp.writeFile(`${await engineDirectory(repo.ports)}/operations-state.json`, '{ not json');
		await must(repo, ['update-ref', '-d', `${SNAPSHOT_REF_PREFIX}${first}`]);

		expect((await undo(repo.ports, second, [])).kind).toBe('done');

		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await undo(repo.ports, first, [])).toEqual({ kind: 'unavailable', reason: 'stale-operation-id' });
		expect((await readOperationLog(repo.ports)).find(entry => entry.record.id === first)?.expired).toBe(true);
	});

	test('an entry whose undo would restore a redo snapshot that is gone is not offered', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'c.txt': 'theirs\n' });
		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		expect((await undoHead(repo.ports))?.id).toBe(id);
		const redoRecord = (await readRecords(repo.ports)).at(-1)!;
		expect(redoRecord.role).toEqual({ kind: 'redo', target: id });

		await must(repo, ['update-ref', '-d', `${SNAPSHOT_REF_PREFIX}${redoRecord.id}`]);

		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await undo(repo.ports, id, [])).toEqual({ kind: 'unavailable', reason: 'stale-operation-id' });
	});

	test('undo is refused after another tool adds a commit', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'a.txt': 'theirs\n' });
		await repo.write('b.txt', 'other tool\n');
		const other = await repo.commit('other tool');

		expect(await undo(repo.ports, id, [])).toEqual({ kind: 'project-changed' });
		expect(await branch(repo)).toBe(other);
		expect((await undoHead(repo.ports))?.id).toBe(id);
	});

	test('redo is refused after another tool adds a commit', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'a.txt': 'theirs\n' });
		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		await repo.write('b.txt', 'other tool\n');
		const other = await repo.commit('other tool');

		expect(await redo(repo.ports, id, [])).toEqual({ kind: 'project-changed' });
		expect(await branch(repo)).toBe(other);
		expect((await redoHead(repo.ports))?.id).toBe(id);
	});

	test('undo with a non-head id is stale-operation-id', async () => {
		const repo = await create();
		const first = await getChanges(repo, { 'a.txt': 'A\n' });
		const second = await getChanges(repo, { 'a.txt': 'B\n' });

		expect(await undo(repo.ports, first, [])).toEqual({ kind: 'unavailable', reason: 'stale-operation-id' });
		expect(await redo(repo.ports, second, [])).toEqual({ kind: 'unavailable', reason: 'stale-operation-id' });
		expect(await repo.read('a.txt')).toBe('B\n');
	});

	test('undo of a checkpoint in the shared copy is shared-checkpoint', async () => {
		const repo = await create();
		const clone = await repo.clone();
		repos.push(clone);
		await repo.write('a.txt', 'two\n');
		const id = await checkpoint(repo, { 'a.txt': 'two\n' });
		const shared = await branch(repo);
		await must(repo, ['push', 'origin', 'main']);

		expect(await undo(repo.ports, id, [])).toEqual({ kind: 'unavailable', reason: 'shared-checkpoint' });
		expect(await branch(repo)).toBe(shared);
	});

	test('send-changes clears both lists', async () => {
		const repo = await create();
		await checkpoint(repo, { 'a.txt': 'A\n' });
		const second = await checkpoint(repo, { 'a.txt': 'B\n' });
		expect((await undo(repo.ports, second, [])).kind).toBe('done');

		await noteNewOperation(repo.ports, 'send-changes');

		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await redoHead(repo.ports)).toBeUndefined();
		expect((await readOperationLog(repo.ports)).every(entry => entry.expired)).toBe(true);
	});

	test('an undo that fails leaves the lists unchanged', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'a.txt': 'theirs\n' });
		const before = await projectState(repo);

		const result = await undo(faultPorts(repo.ports, { failAt: 3 }), id, []);

		expect(result.kind).toBe('could-not-finish');
		expect(await projectState(repo)).toEqual(before);
		expect((await undoHead(repo.ports))?.id).toBe(id);
		expect(await redoHead(repo.ports)).toBeUndefined();
	});

	test('undo moves a file kept aside by the operation back', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		const { plan } = await collidingProject(repo);
		const id = doneId(await runOperation(repo.ports, { ...plan, collisionChoices: [{ path: 'debug.log', choice: 'use-theirs-keep-copy' }] }));
		expect(await repo.read('debug.log')).toBe('incoming\n');

		expect((await undo(repo.ports, id, [])).kind).toBe('done');

		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await listKept(repo.ports)).toEqual([]);
	});

	test('the 51st operation expires the 1st and deletes its snapshot ref', async () => {
		const repo = await create();
		const ids: string[] = [];
		for (let index = 0; index < 51; index++) {
			ids.push(await checkpoint(repo, {}, { kind: 'edit-description' }));
		}

		await expire(repo.ports);

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${ids[0]}`)).toBe(false);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${ids[1]}`)).toBe(true);
		const log = await readOperationLog(repo.ports);
		expect(log.filter(entry => entry.expired).map(entry => entry.record.id)).toEqual([ids[0]]);
		expect((await undoHead(repo.ports))?.id).toBe(ids[50]);
	}, 120_000);

	test('an operation older than 30 days expires', async () => {
		const repo = await create();
		const old = await checkpoint(repo, { 'a.txt': 'A\n' });
		repo.clock.advance(20 * DAY_MS);
		const recent = await checkpoint(repo, { 'a.txt': 'B\n' });
		repo.clock.advance(11 * DAY_MS);

		await expire(repo.ports);

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${old}`)).toBe(false);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${recent}`)).toBe(true);
		expect((await undoHead(repo.ports))?.id).toBe(recent);
		expect((await undo(repo.ports, recent, [])).kind).toBe('done');
		expect(await undoHead(repo.ports)).toBeUndefined();
	});

	test('a snapshot on the redo list is not deleted', async () => {
		const repo = await create();
		const id = await getChanges(repo, { 'a.txt': 'theirs\n' });
		await repo.write('a.txt', 'theirs\nand mine\n');
		expect((await undo(repo.ports, id, [])).kind).toBe('done');
		const undoRecord = (await readRecords(repo.ports)).at(-1)!.id;
		repo.clock.advance(40 * DAY_MS);

		await expire(repo.ports);

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${id}`)).toBe(true);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${undoRecord}`)).toBe(true);
		expect((await redo(repo.ports, id, [])).kind).toBe('done');
		expect(await repo.read('a.txt')).toBe('theirs\nand mine\n');
	});

	test('expiry does not delete kept files', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		const { plan } = await collidingProject(repo);
		const id = doneId(await runOperation(repo.ports, { ...plan, collisionChoices: [{ path: 'debug.log', choice: 'use-theirs-keep-copy' }] }));
		const kept = await listKept(repo.ports);
		expect(kept).toHaveLength(1);
		repo.clock.advance(31 * DAY_MS);

		await expire(repo.ports);
		await noteNewOperation(repo.ports, 'send-changes');

		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}${id}`)).toBe(false);
		expect(await listKept(repo.ports)).toEqual(kept);
	});
});
