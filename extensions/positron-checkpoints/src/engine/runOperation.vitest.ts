/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { splitZ } from './git';
import { acquireLock, classify, classifyPaths, engineDirectory, readRecords, TriState, writeRecord } from './journal';
import { EnginePorts, GitRunner } from './ports';
import { OperationPlan, reverse, runOperation } from './runOperation';
import { faultPorts } from './test/faultPorts';
import { afterJournal, currentState, must, projectState, referenceProject, refExists, treeWith } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES, RECOVERY_REF_PREFIX, SNAPSHOT_REF_PREFIX, worktreeTree } from './trees';

describe('runOperation', () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('applies files, index, and branch to three different after values', async () => {
		const repo = await create();
		const { b, plan } = await referenceProject(repo);
		const treeB = plan.after.indexTree;
		const after: TriState = { ...plan.after, worktreeTree: await treeWith(repo, plan.after.worktreeTree, { 'a.txt': 'two\nunrecorded\n' }) };

		const result = await runOperation(repo.ports, { ...plan, after });

		expect(result).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: [] });
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(b);
		expect(await must(repo, ['write-tree'])).toBe(treeB);
		expect((await worktreeTree(repo.ports)).tree).toBe(after.worktreeTree);
		expect(await repo.read('a.txt')).toBe('two\nunrecorded\n');
		expect((await repo.git(['status', '--porcelain', '-z'])).stdout).toBe(' M a.txt\0?? u.txt\0');
		const [record] = await readRecords(repo.ports);
		expect(record.status).toBe('complete');
		expect(record.progress).toEqual([
			{ step: 'path', path: 'b.txt' },
			{ step: 'path', path: 'a.txt', temporary: expect.stringMatching(/^\.a\.txt\.[0-9a-f]{12}\.positron-checkpoints-tmp$/) },
			{ step: 'path', path: 'd.txt', temporary: expect.stringMatching(/^\.d\.txt\.[0-9a-f]{12}\.positron-checkpoints-tmp$/) },
			{ step: 'index' },
			{ step: 'branch' },
		]);
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/backup/op-1`).catch(() => undefined)).toBeUndefined();
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/lock`).catch(() => undefined)).toBeUndefined();
	});

	test('writes links and executable files, and removes folders a removal leaves empty', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.write('dir/deep/only.txt', 'only\n');
		const a = await repo.commit('A');
		const treeB = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), {
			'dir/deep/only.txt': null,
			'link': 'link:a.txt',
			'run.sh': 'exec:#!/bin/sh\n',
		});
		const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
		const result = await runOperation(repo.ports, { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after: { branchCommit: b, indexTree: treeB, worktreeTree: treeB }, collisionChoices: [] });
		expect(result.kind).toBe('done');
		expect(await fsp.readlink(path.join(repo.root, 'link'))).toBe('a.txt');
		expect((await fsp.stat(path.join(repo.root, 'run.sh'))).mode & 0o100).toBe(0o100);
		expect(await fsp.stat(path.join(repo.root, 'dir')).catch(() => undefined)).toBeUndefined();
		expect((await repo.git(['status', '--porcelain'])).stdout).toBe('');
	});

	test('with core.autocrlf=true a file is written with the bytes git checkout writes and restored with its own bytes', async () => {
		const prepare = async () => {
			const repo = await create();
			const { a, b, plan } = await referenceProject(repo);
			await must(repo, ['config', 'core.autocrlf', 'true']);
			await repo.write('a.txt', 'one\r\n');
			await repo.write('c.txt', 'sea\r\n');
			return { repo, a, b, plan };
		};
		/** The bytes `git checkout` writes for a path of a commit. */
		const checkedOut = async (repo: TempRepo, commit: string, file: string) =>
			(await repo.git(['cat-file', '--filters', `--path=${file}`, `${commit}:${file}`])).stdout;

		const finished = await prepare();
		// `git status` lists a file whose size changed even when its content did not, so compare content.
		const changedContent = async () => (await finished.repo.git(['diff', 'HEAD', '--name-only'])).stdout;
		expect(await changedContent()).toBe('');
		expect((await runOperation(finished.repo.ports, finished.plan)).kind).toBe('done');
		expect(await must(finished.repo, ['rev-parse', 'refs/heads/main'])).toBe(finished.b);
		expect(await finished.repo.read('a.txt')).toBe('two\r\n');
		expect(await finished.repo.read('a.txt')).toBe(await checkedOut(finished.repo, finished.b, 'a.txt'));
		expect(await finished.repo.read('d.txt')).toBe('dee\r\n');
		expect(await finished.repo.read('c.txt')).toBe('sea\r\n');
		expect(await changedContent()).toBe('');

		const failed = await prepare();
		const ports = afterJournal(failed.repo.ports, async () => {
			await must(failed.repo, ['update-ref', 'refs/heads/main', await must(failed.repo, ['commit-tree', failed.plan.after.indexTree, '-p', failed.a, '-m', 'Elsewhere'])]);
		});
		expect((await runOperation(ports, failed.plan)).kind).toBe('could-not-finish');
		expect(await failed.repo.read('a.txt')).toBe('one\r\n');
		// b.txt was written before core.autocrlf was set, so git checkout would give it other bytes.
		expect(await checkedOut(failed.repo, failed.a, 'b.txt')).toBe('bee\r\n');
		expect(await failed.repo.read('b.txt')).toBe('bee\n');
	});

	test('a file with a clean and smudge filter is written smudged and reads as its blob', async () => {
		const repo = await create();
		await must(repo, ['config', 'filter.upper.smudge', 'tr a-z A-Z']);
		await must(repo, ['config', 'filter.upper.clean', 'tr A-Z a-z']);
		await repo.write('.gitattributes', '*.up filter=upper\n');
		await repo.write('f.up', 'HELLO\n');
		const a = await repo.commit('A');
		expect(await must(repo, ['cat-file', 'blob', `${a}:f.up`])).toBe('hello');
		const treeB = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { 'f.up': 'world\n' });
		const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
		const after = { branchCommit: b, indexTree: treeB, worktreeTree: treeB };

		const result = await runOperation(repo.ports, { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after, collisionChoices: [] });

		expect(result.kind).toBe('done');
		expect(await repo.read('f.up')).toBe('WORLD\n');
		const [record] = await readRecords(repo.ports);
		expect(await classifyPaths(repo.ports, record.paths)).toEqual([{ path: 'f.up', part: 'after' }]);
		expect((await repo.git(['diff', 'HEAD', '--name-only'])).stdout).toBe('');
	});

	test.each([
		['an edit saved', async (repo: TempRepo) => repo.write('a.txt', 'edited since\n')],
		['a staged change', async (repo: TempRepo) => {
			const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: 'staged since\n' });
			await must(repo, ['update-index', '--cacheinfo', `100644,${blob},c.txt`]);
		}],
		['a moved branch', async (repo: TempRepo) => {
			const head = await must(repo, ['rev-parse', 'HEAD']);
			await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', `${head}^{tree}`, '-p', head, '-m', 'Since'])]);
		}],
	])('%s between computing the plan and running it gives changes-moved and changes nothing', async (_name, change) => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		await change(repo);
		const before = await projectState(repo);

		expect(await runOperation(repo.ports, plan)).toEqual({ kind: 'changes-moved' });

		expect(await projectState(repo)).toEqual(before);
		expect(await readRecords(repo.ports)).toEqual([]);
		expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}op-1`)).toBe(false);
	});

	test('a failed operation restores the original bytes and permission bits of a file a lossy clean filter stores', async () => {
		const repo = await create();
		await must(repo, ['config', 'filter.lower.clean', 'tr A-Z a-z']);
		await repo.write('.gitattributes', '*.txt filter=lower\n');
		await repo.write('a.txt', 'Mixed Case\n');
		await repo.write('b.txt', 'Keep Me\n');
		const a = await repo.commit('A');
		expect(await must(repo, ['cat-file', 'blob', `${a}:a.txt`])).toBe('mixed case');
		await fsp.chmod(path.join(repo.root, 'a.txt'), 0o600);
		const treeB = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { 'a.txt': 'other\n', 'b.txt': null });
		const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
		const plan: OperationPlan = { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after: { branchCommit: b, indexTree: treeB, worktreeTree: treeB }, collisionChoices: [] };
		const ports = afterJournal(repo.ports, async () => {
			await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'Elsewhere'])]);
		});

		expect((await runOperation(ports, plan)).kind).toBe('could-not-finish');

		expect(await repo.read('a.txt')).toBe('Mixed Case\n');
		expect((await fsp.stat(path.join(repo.root, 'a.txt'))).mode & 0o777).toBe(0o600);
		expect(await repo.read('b.txt')).toBe('Keep Me\n');
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/backup/op-1`).catch(() => undefined)).toBeUndefined();
	});

	test('a replaced file keeps its permission bits apart from the executable bit, and a new file follows the umask', async () => {
		const repo = await create();
		await repo.write('private.txt', 'one\n');
		await repo.write('tool.sh', 'one\n');
		const a = await repo.commit('A');
		await fsp.chmod(path.join(repo.root, 'private.txt'), 0o600);
		await fsp.chmod(path.join(repo.root, 'tool.sh'), 0o640);
		const treeB = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { 'private.txt': 'two\n', 'tool.sh': 'exec:two\n', 'new.txt': 'new\n' });
		const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
		const plan: OperationPlan = { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after: { branchCommit: b, indexTree: treeB, worktreeTree: treeB }, collisionChoices: [] };
		const previous = process.umask(0o027);
		try {
			expect((await runOperation(repo.ports, plan)).kind).toBe('done');
		} finally {
			process.umask(previous);
		}
		const mode = async (file: string) => (await fsp.stat(path.join(repo.root, file))).mode & 0o777;
		expect(await mode('private.txt')).toBe(0o600);
		expect(await mode('tool.sh')).toBe(0o750);
		expect(await mode('new.txt')).toBe(0o640);
	});

	test('a file at the old fixed temporary name is never replaced or removed', async () => {
		const repo = await create();
		const { a, plan } = await referenceProject(repo);
		await repo.write('.a.txt.positron-checkpoints-tmp', 'my own file\n');
		const done = await runOperation(repo.ports, { ...plan, expected: await currentState(repo) });
		expect(done.kind).toBe('done');
		expect(await repo.read('.a.txt.positron-checkpoints-tmp')).toBe('my own file\n');

		// A failed run and its reversal leave it too.
		await must(repo, ['reset', '-q', '--hard', a]);
		const ports = afterJournal(repo.ports, async () => {
			await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', plan.after.indexTree, '-p', a, '-m', 'Elsewhere'])]);
		});
		expect((await runOperation(ports, { ...plan, expected: await currentState(repo) })).kind).toBe('could-not-finish');
		expect(await repo.read('.a.txt.positron-checkpoints-tmp')).toBe('my own file\n');
	});

	test('the path is checked after its new content is ready, right before it is replaced', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const ports = faultPorts(repo.ports, {});
		expect((await runOperation(ports, plan)).kind).toBe('done');
		const forA = ports.mutatingCalls.filter(call => /\.a\.txt\.|a\.txt$/.test(call)).map(call => call.split(' ')[0]);
		expect(forA).toEqual(['cat-file', 'setPermissions', 'linkOrCopy', 'move']);

		// An edit made while the new content is prepared stops the operation before a.txt changes.
		const edited = await create();
		const second = await referenceProject(edited);
		const editing: EnginePorts = {
			...edited.ports,
			files: {
				...edited.ports.files,
				setPermissions: async (file, executable, like) => {
					await edited.ports.files.setPermissions(file, executable, like);
					if (file.includes('.a.txt.')) {
						await edited.write('a.txt', 'edited meanwhile\n');
					}
				},
			},
		};
		expect((await runOperation(editing, second.plan)).kind).toBe('could-not-finish');
		expect(await edited.read('a.txt')).toBe('edited meanwhile\n');
		expect(splitZ((await edited.git(['ls-files', '-z', '--others', '--exclude-standard'])).stdout).sort()).toEqual(['u.txt']);
	});

	test('a busy lock returns unavailable busy and changes nothing', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		const lock = await acquireLock(repo.ports);
		expect(await runOperation(repo.ports, plan)).toEqual({ kind: 'unavailable', reason: 'busy' });
		expect(await projectState(repo)).toEqual(before);
		expect(await readRecords(repo.ports)).toEqual([]);
		await lock!.release();
	});

	test('a project with HEAD on no branch is unavailable', async () => {
		const repo = await create();
		const { a, plan } = await referenceProject(repo);
		await must(repo, ['checkout', '-q', '--detach', a]);
		expect(await runOperation(repo.ports, plan)).toMatchObject({ kind: 'unavailable', reason: 'unusual-state' });
	});

	test('a path changed after the journal step stops the operation and rolls back', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		const ports = afterJournal(repo.ports, () => repo.write('a.txt', 'edited elsewhere\n'));

		const result = await runOperation(ports, plan);

		expect(result.kind).toBe('could-not-finish');
		expect(await repo.read('a.txt')).toBe('edited elsewhere\n');
		const now = await projectState(repo);
		expect({ ...now, worktree: undefined }).toEqual({ ...before, worktree: undefined });
		expect(now.worktree).toBe(await treeWith(repo, before.worktree, { 'a.txt': 'edited elsewhere\n' }));
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('an index changed after the journal step stops the operation and rolls back', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		let staged = '';
		const ports = afterJournal(repo.ports, async () => {
			const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: 'staged elsewhere\n' });
			await must(repo, ['update-index', '--cacheinfo', `100644,${blob},c.txt`]);
			staged = await must(repo, ['write-tree']);
		});

		const result = await runOperation(ports, plan);

		expect(result.kind).toBe('could-not-finish');
		expect(await projectState(repo)).toEqual({ ...before, index: staged });
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('an index another tool set to the after tree is left as it is', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		const ports = afterJournal(repo.ports, async () => {
			await must(repo, ['read-tree', plan.after.indexTree]);
		});

		const result = await runOperation(ports, plan);

		expect(result.kind).toBe('could-not-finish');
		// b.txt is back on disk; the index the other tool set has no entry for it.
		expect(await projectState(repo)).toEqual({ ...before, index: plan.after.indexTree, untracked: [...before.untracked, 'b.txt'].sort() });
	});

	test('a failed reversal returns interrupted, releases the lock, and blocks later operations', async () => {
		const repo = await create();
		const { a, plan } = await referenceProject(repo);
		let failing = false;
		const git: GitRunner = async (args, options) => {
			if (args.includes('update-ref') && args.includes('refs/heads/main')) {
				// The branch move fails, and from then on every file move fails too.
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

		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/lock`).catch(() => undefined)).toBeUndefined();
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(a);
		expect(await runOperation(repo.ports, { ...plan, expected: await currentState(repo) }))
			.toEqual({ kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' });
	});

	test('a prepared record from an earlier run blocks a new operation', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		await writeRecord(repo.ports, {
			id: 'earlier', kind: 'go-back', description: 'Earlier', time: '2026-01-01T00:00:00.000Z', branch: 'main',
			before: plan.expected, after: plan.after, paths: [], skipped: [], keptMoves: [], progress: [], status: 'prepared',
		});
		expect(await runOperation(repo.ports, plan)).toEqual({ kind: 'unavailable', reason: 'busy', detail: 'unresolved-operation' });
		expect(await projectState(repo)).toEqual(before);
	});

	test('a branch moved by another tool makes the last step fail and rolls back', async () => {
		const repo = await create();
		const { a, plan } = await referenceProject(repo);
		const before = await projectState(repo);
		let moved = '';
		const ports = afterJournal(repo.ports, async () => {
			moved = await must(repo, ['commit-tree', plan.after.indexTree, '-p', a, '-m', 'Elsewhere']);
			await must(repo, ['update-ref', 'refs/heads/main', moved]);
		});

		const result = await runOperation(ports, plan);

		expect(result.kind).toBe('could-not-finish');
		expect(await projectState(repo)).toEqual({ ...before, branch: moved });
		expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
	});

	test('work staged by another tool after the index step survives a failed branch move', async () => {
		const repo = await create();
		const { a, plan } = await referenceProject(repo);
		const before = await projectState(repo);
		let staged = '';
		const git: GitRunner = async (args, options) => {
			const result = await repo.ports.git(args, options);
			if (args.includes('read-tree') && staged === '') {
				const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: 'staged elsewhere\n' });
				await must(repo, ['update-index', '--cacheinfo', `100644,${blob},c.txt`]);
				staged = await must(repo, ['write-tree']);
				await must(repo, ['update-ref', 'refs/heads/main', await must(repo, ['commit-tree', plan.after.indexTree, '-p', a, '-m', 'Elsewhere'])]);
			}
			return result;
		};

		const result = await runOperation({ ...repo.ports, git }, plan);

		expect(result).toEqual({ kind: 'interrupted' });
		const now = await projectState(repo);
		expect(now.index).toBe(staged);
		expect(now.worktree).toBe(before.worktree);
		expect(await must(repo, ['rev-parse', '--verify', `${RECOVERY_REF_PREFIX}op-1`])).not.toBe('');
		expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
	});

	test('an untracked or skipped file is never written or removed', async () => {
		const repo = await create();
		const { plan } = await referenceProject(repo);
		// The after tree has no u.txt, which would remove it if untracked files were removed.
		const result = await runOperation(repo.ports, { ...plan, after: { ...plan.after, worktreeTree: plan.after.indexTree } });
		expect(result.kind).toBe('done');
		expect(await repo.read('u.txt')).toBe('untracked\n');

		// A skipped large file and an ignored file are in no snapshot, so an incoming file at
		// their path stops the operation before either is replaced.
		const big = path.join(repo.root, 'big.bin');
		await fsp.writeFile(big, '');
		await fsp.truncate(big, LARGE_FILE_BYTES + 1);
		const head = await must(repo, ['rev-parse', 'HEAD']);
		const headTree = await must(repo, ['rev-parse', 'HEAD^{tree}']);
		for (const file of ['big.bin', 'debug.log']) {
			const tree = await treeWith(repo, headTree, { [file]: 'incoming\n' });
			const commit = await must(repo, ['commit-tree', tree, '-p', head, '-m', 'Incoming']);
			const refused = await runOperation(repo.ports, { ...plan, expected: await currentState(repo), after: { branchCommit: commit, indexTree: tree, worktreeTree: tree } });
			expect(refused.kind).toBe('could-not-finish');
			expect(await must(repo, ['rev-parse', 'HEAD'])).toBe(head);
		}
		expect((await fsp.stat(big)).size).toBe(LARGE_FILE_BYTES + 1);
		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await repo.read('u.txt')).toBe('untracked\n');
	});

	test('a hook-edited file is recorded, and a failed operation leaves it as the hook wrote it', async () => {
		const prepare = async () => {
			const repo = await create();
			const { a, plan } = await referenceProject(repo);
			const oldBlob = await must(repo, ['rev-parse', 'HEAD:c.txt']);
			await repo.write('c.txt', 'formatted\n');
			const newBlob = await must(repo, ['hash-object', '--stdin'], { stdin: 'formatted\n' });
			const extraPaths = [{ path: 'c.txt', before: oldBlob, after: newBlob, beforeMode: '100644' as const, afterMode: '100644' as const }];
			const after = { ...plan.after, worktreeTree: await treeWith(repo, plan.after.worktreeTree, { 'c.txt': 'formatted\n' }) };
			return { repo, a, plan: { ...plan, expected: await currentState(repo), after, extraPaths } };
		};

		const finished = await prepare();
		expect(await runOperation(finished.repo.ports, finished.plan)).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: ['c.txt'] });
		expect((await readRecords(finished.repo.ports))[0].paths.map(plan => plan.path)).toEqual(['b.txt', 'a.txt', 'd.txt', 'c.txt']);
		expect(await finished.repo.read('c.txt')).toBe('formatted\n');

		const failed = await prepare();
		const ports = afterJournal(failed.repo.ports, async () => {
			await must(failed.repo, ['update-ref', 'refs/heads/main', await must(failed.repo, ['commit-tree', failed.plan.after.indexTree, '-p', failed.a, '-m', 'Elsewhere'])]);
		});
		// The engine never wrote it, so the rollback leaves it (spec 6.1: the files stay rewritten).
		expect((await runOperation(ports, failed.plan)).kind).toBe('could-not-finish');
		expect(await failed.repo.read('c.txt')).toBe('formatted\n');
		expect(await failed.repo.read('a.txt')).toBe('one\n');
	});
});

/**
 * The mutating calls of the reference operation, measured once. Every call up to and
 * including the branch move is a point where the operation can fail; the call after it
 * releases the lock.
 */
const referenceCalls = await (async () => {
	const repo = await tempRepo();
	try {
		const { plan } = await referenceProject(repo);
		const ports = faultPorts(repo.ports, {});
		const result = await runOperation(ports, plan);
		if (result.kind !== 'done') {
			throw new Error(`the reference operation did not finish: ${JSON.stringify(result)}`);
		}
		return ports.mutatingCalls;
	} finally {
		await repo.dispose();
	}
})();
const branchMove = referenceCalls.indexOf('update-ref refs/heads/main') + 1;
const failurePoints = Array.from({ length: branchMove }, (_, index) => index + 1);

describe('runOperation failure injection', () => {
	test('the reference operation moves the branch, then only removes its backups and releases the lock', () => {
		expect(branchMove).toBeGreaterThan(5);
		expect(referenceCalls.slice(branchMove)).toEqual([
			expect.stringMatching(/^remove .*\/positron-checkpoints\/backup\/op-1$/),
			expect.stringMatching(/^remove .*\/positron-checkpoints\/lock$/),
		]);
	});

	test.each(failurePoints)('failure at mutating call %i returns could-not-finish and restores the exact before state', async failAt => {
		const repo = await tempRepo();
		try {
			const { plan } = await referenceProject(repo);
			const before = await projectState(repo);
			const ports = faultPorts(repo.ports, { failAt });

			const result = await runOperation(ports, plan);

			expect(result.kind).toBe('could-not-finish');
			expect(await projectState(repo)).toEqual(before);
			const records = await readRecords(repo.ports);
			for (const record of records) {
				expect(record.status).toBe('rolled-back');
			}
			if (records.length === 0) {
				expect(await refExists(repo, `${SNAPSHOT_REF_PREFIX}op-1`)).toBe(false);
			}
			expect(await fsp.stat(`${await engineDirectory(repo.ports)}/lock`).catch(() => undefined)).toBeUndefined();
		} finally {
			await repo.dispose();
		}
	});
	/** Runs the reference operation with every call failing from mutating call `stopAt` on, as a crash does. */
	const crashAt = async (repo: TempRepo, label: RegExp) => {
		const stopAt = referenceCalls.findIndex(call => label.test(call)) + 1;
		expect(stopAt).toBeGreaterThan(0);
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		const ports = faultPorts(repo.ports, { stopAt });
		expect(await runOperation(ports, plan)).toEqual({ kind: 'interrupted' });
		const [record] = await readRecords(repo.ports);
		return { before, record };
	};

	test.each([
		/^cat-file > .*\/\.a\.txt\.[0-9a-f]+\.positron-checkpoints-tmp$/,
		/^linkOrCopy a\.txt$/,
		/^move \.a\.txt\.[0-9a-f]+\.positron-checkpoints-tmp$/,
	])('a crash at "%s" leaves the path whole and listed, and reverse restores the project', async label => {
		const repo = await tempRepo();
		try {
			const { before, record } = await crashAt(repo, label);
			expect(record.status).toBe('prepared');
			expect(record.progress).toContainEqual(expect.objectContaining({ step: 'path', path: 'a.txt' }));
			expect(['one\n', 'two\n']).toContain(await repo.read('a.txt'));
			const part = (await classify(repo.ports, record)).paths.find(entry => entry.path === 'a.txt')!.part;
			expect(['before', 'after']).toContain(part);

			expect(await reverse(repo.ports, record, 'all-or-report')).toBe('reversed');
			expect(await projectState(repo)).toEqual(before);
			expect((await readRecords(repo.ports))[0].status).toBe('rolled-back');
		} finally {
			await repo.dispose();
		}
	});

	test('a crash after read-tree, then work staged by another tool, is reported and not marked rolled back', async () => {
		const repo = await tempRepo();
		try {
			const { record } = await crashAt(repo, /^update-ref refs\/heads\/main$/);
			expect(record.progress).toContainEqual({ step: 'index' });
			expect(await must(repo, ['write-tree'])).toBe(record.after.indexTree);
			const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: 'staged elsewhere\n' });
			await must(repo, ['update-index', '--cacheinfo', `100644,${blob},c.txt`]);
			const staged = await must(repo, ['write-tree']);
			expect((await classify(repo.ports, record)).index).toBe('unexpected');

			expect(await reverse(repo.ports, record, 'all-or-report')).toBe('has-unexpected');
			expect(await must(repo, ['write-tree'])).toBe(staged);
			expect((await readRecords(repo.ports))[0].status).toBe('interrupted');
			expect(await refExists(repo, `${RECOVERY_REF_PREFIX}${record.id}`)).toBe(true);
		} finally {
			await repo.dispose();
		}
	});
});
