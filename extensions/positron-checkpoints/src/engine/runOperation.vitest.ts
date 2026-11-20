/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { splitZ } from './git';
import { acquireLock, classify, classifyPaths, engineDirectory, readRecords, TriState, writeRecord } from './journal';
import { EnginePorts, GitRunner } from './ports';
import { OperationPlan, reverse, runOperation } from './runOperation';
import { faultPorts } from './test/faultPorts';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES, RECOVERY_REF_PREFIX, SNAPSHOT_REF_PREFIX, worktreeTree } from './trees';

async function must(repo: TempRepo, args: string[], options?: Parameters<GitRunner>[1]): Promise<string> {
	const result = await repo.git(args, options);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

/**
 * Builds a tree from `base` with each file of `files` set to its text, or removed when the
 * value is null, without touching the repository's index or working files. A value starting
 * with `link:` is a symbolic link, and one starting with `exec:` is an executable file.
 */
async function treeWith(repo: TempRepo, base: string, files: Record<string, string | null>): Promise<string> {
	const env = { GIT_INDEX_FILE: path.join(os.tmpdir(), `positron-checkpoints-test-index-${Math.random()}`) };
	try {
		await must(repo, ['read-tree', base], { env });
		for (const [file, value] of Object.entries(files)) {
			if (value === null) {
				await must(repo, ['update-index', '--force-remove', '--', file], { env });
				continue;
			}
			const [mode, text] = value.startsWith('link:') ? ['120000', value.slice(5)] : value.startsWith('exec:') ? ['100755', value.slice(5)] : ['100644', value];
			const blob = await must(repo, ['hash-object', '-w', '--stdin'], { stdin: text });
			await must(repo, ['update-index', '--add', '--cacheinfo', `${mode},${blob},${file}`], { env });
		}
		return await must(repo, ['write-tree'], { env });
	} finally {
		await fsp.rm(env.GIT_INDEX_FILE, { force: true });
	}
}

/** The branch commit, index tree, and working-file tree of the project now, as a plan's `expected`. */
async function currentState(repo: TempRepo): Promise<TriState> {
	return {
		branchCommit: await must(repo, ['rev-parse', 'refs/heads/main']),
		indexTree: await must(repo, ['write-tree']),
		worktreeTree: (await worktreeTree(repo.ports)).tree,
	};
}

/** True when the ref exists. */
async function refExists(repo: TempRepo, ref: string): Promise<boolean> {
	return (await repo.git(['rev-parse', '--verify', '-q', ref])).exitCode === 0;
}

/** The three parts of the project as they are now, and the untracked and ignored files. */
async function projectState(repo: TempRepo) {
	return {
		branch: await must(repo, ['rev-parse', 'refs/heads/main']),
		index: await must(repo, ['write-tree']),
		worktree: (await worktreeTree(repo.ports)).tree,
		untracked: splitZ((await repo.git(['ls-files', '-z', '--others'])).stdout).sort(),
		ignored: await repo.read('debug.log'),
	};
}

/**
 * A project at commit A (a.txt, b.txt, c.txt) with an untracked u.txt and an ignored
 * debug.log, and the plan of an operation that moves it to commit B, which changes three
 * files: a.txt edited, b.txt removed, d.txt added.
 */
async function referenceProject(repo: TempRepo): Promise<{ a: string; b: string; plan: OperationPlan }> {
	await repo.write('.gitignore', '*.log\n');
	await repo.write('a.txt', 'one\n');
	await repo.write('b.txt', 'bee\n');
	await repo.write('c.txt', 'sea\n');
	const a = await repo.commit('A');
	const treeA = await must(repo, ['rev-parse', 'HEAD^{tree}']);
	const treeB = await treeWith(repo, treeA, { 'a.txt': 'two\n', 'b.txt': null, 'd.txt': 'dee\n' });
	const b = await must(repo, ['commit-tree', treeB, '-p', a, '-m', 'B']);
	await repo.write('u.txt', 'untracked\n');
	await repo.write('debug.log', 'ignored\n');
	const after: TriState = { branchCommit: b, indexTree: treeB, worktreeTree: await treeWith(repo, treeB, { 'u.txt': 'untracked\n' }) };
	return { a, b, plan: { kind: 'go-back', description: 'Go back', expected: await currentState(repo), after, collisionChoices: [] } };
}

/** Ports whose journal runs `fn` once, right after the operation's record is written. */
function afterJournal(ports: EnginePorts, fn: () => Promise<void>): EnginePorts {
	let done = false;
	return {
		...ports,
		files: {
			...ports.files,
			appendDurable: async (file, line) => {
				await ports.files.appendDurable(file, line);
				if (!done && line.includes('"type":"record"')) {
					done = true;
					await fn();
				}
			},
		},
	};
}

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
			{ step: 'path', path: 'a.txt' },
			{ step: 'path', path: 'd.txt' },
			{ step: 'index' },
			{ step: 'branch' },
		]);
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

	test('with core.autocrlf=true a file is written and restored with the bytes git checkout writes', async () => {
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
		expect(await failed.repo.read('a.txt')).toBe(await checkedOut(failed.repo, failed.a, 'a.txt'));
		expect(await failed.repo.read('b.txt')).toBe(await checkedOut(failed.repo, failed.a, 'b.txt'));
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
	test('the reference operation moves the branch, then only releases the lock', () => {
		expect(branchMove).toBeGreaterThan(5);
		expect(referenceCalls.slice(branchMove)).toEqual([expect.stringMatching(/^remove .*\/positron-checkpoints\/lock$/)]);
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
	const crashAt = async (repo: TempRepo, label: string) => {
		const stopAt = referenceCalls.findIndex(call => call.startsWith(label)) + 1;
		expect(stopAt).toBeGreaterThan(0);
		const { plan } = await referenceProject(repo);
		const before = await projectState(repo);
		const ports = faultPorts(repo.ports, { stopAt });
		expect(await runOperation(ports, plan)).toEqual({ kind: 'interrupted' });
		const [record] = await readRecords(repo.ports);
		return { before, record };
	};

	test.each(['write .a.txt.positron-checkpoints-tmp', 'move .a.txt.positron-checkpoints-tmp'])('a crash at "%s" leaves the path whole and listed, and reverse restores the project', async label => {
		const repo = await tempRepo();
		try {
			const { before, record } = await crashAt(repo, label);
			expect(record.status).toBe('prepared');
			expect(record.progress).toContainEqual({ step: 'path', path: 'a.txt' });
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
			const { record } = await crashAt(repo, 'update-ref refs/heads/main');
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
