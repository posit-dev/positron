/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { splitZ } from './git';
import { acquireLock, engineDirectory, readRecords, TriState } from './journal';
import { EnginePorts, GitRunner } from './ports';
import { OperationPlan, runOperation } from './runOperation';
import { faultPorts } from './test/faultPorts';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES, RECOVERY_REF_PREFIX, worktreeTree } from './trees';

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
	return { a, b, plan: { kind: 'go-back', description: 'Go back', after, collisionChoices: [] } };
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
		const result = await runOperation(repo.ports, { kind: 'go-back', description: 'Go back', after: { branchCommit: b, indexTree: treeB, worktreeTree: treeB }, collisionChoices: [] });
		expect(result.kind).toBe('done');
		expect(await fsp.readlink(path.join(repo.root, 'link'))).toBe('a.txt');
		expect((await fsp.stat(path.join(repo.root, 'run.sh'))).mode & 0o100).toBe(0o100);
		expect(await fsp.stat(path.join(repo.root, 'dir')).catch(() => undefined)).toBeUndefined();
		expect((await repo.git(['status', '--porcelain'])).stdout).toBe('');
	});

	test('with core.autocrlf=true a file with Windows line endings is replaced, and git sees no content change', async () => {
		const repo = await create();
		const { b, plan } = await referenceProject(repo);
		await must(repo, ['config', 'core.autocrlf', 'true']);
		await repo.write('a.txt', 'one\r\n');
		await repo.write('c.txt', 'sea\r\n');
		// `git status` lists a file whose size changed even when its content did not, so compare content.
		const changedContent = async () => (await repo.git(['diff', 'HEAD', '--name-only'])).stdout;
		expect(await changedContent()).toBe('');

		const result = await runOperation(repo.ports, plan);

		expect(result.kind).toBe('done');
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(b);
		expect(await repo.read('a.txt')).toBe('two\n');
		expect(await repo.read('c.txt')).toBe('sea\r\n');
		expect(await changedContent()).toBe('');
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
			const refused = await runOperation(repo.ports, { ...plan, after: { branchCommit: commit, indexTree: tree, worktreeTree: tree } });
			expect(refused.kind).toBe('could-not-finish');
			expect(await must(repo, ['rev-parse', 'HEAD'])).toBe(head);
		}
		expect((await fsp.stat(big)).size).toBe(LARGE_FILE_BYTES + 1);
		expect(await repo.read('debug.log')).toBe('ignored\n');
		expect(await repo.read('u.txt')).toBe('untracked\n');
	});

	test('a hook-edited file is recorded and rolled back with the operation', async () => {
		const prepare = async () => {
			const repo = await create();
			const { a, plan } = await referenceProject(repo);
			const oldBlob = await must(repo, ['rev-parse', 'HEAD:c.txt']);
			await repo.write('c.txt', 'formatted\n');
			const newBlob = await must(repo, ['hash-object', '--stdin'], { stdin: 'formatted\n' });
			const extraPaths = [{ path: 'c.txt', before: oldBlob, after: newBlob, beforeMode: '100644' as const, afterMode: '100644' as const }];
			const after = { ...plan.after, worktreeTree: await treeWith(repo, plan.after.worktreeTree, { 'c.txt': 'formatted\n' }) };
			return { repo, a, plan: { ...plan, after, extraPaths } };
		};

		const finished = await prepare();
		expect(await runOperation(finished.repo.ports, finished.plan)).toEqual({ kind: 'done', operationId: 'op-1', hookEditedFiles: ['c.txt'] });
		expect((await readRecords(finished.repo.ports))[0].paths.map(plan => plan.path)).toEqual(['b.txt', 'a.txt', 'd.txt', 'c.txt']);
		expect(await finished.repo.read('c.txt')).toBe('formatted\n');

		const failed = await prepare();
		const ports = afterJournal(failed.repo.ports, async () => {
			await must(failed.repo, ['update-ref', 'refs/heads/main', await must(failed.repo, ['commit-tree', failed.plan.after.indexTree, '-p', failed.a, '-m', 'Elsewhere'])]);
		});
		expect((await runOperation(ports, failed.plan)).kind).toBe('could-not-finish');
		expect(await failed.repo.read('c.txt')).toBe('sea\n');
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
			for (const record of await readRecords(repo.ports)) {
				expect(record.status).toBe('rolled-back');
			}
			expect(await fsp.stat(`${await engineDirectory(repo.ports)}/lock`).catch(() => undefined)).toBeUndefined();
		} finally {
			await repo.dispose();
		}
	});
});
