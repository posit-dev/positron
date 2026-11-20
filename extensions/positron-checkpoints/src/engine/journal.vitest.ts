/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { spawn } from 'child_process';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { acquireLock, classify, engineDirectory, JournalRecord, PathPlan, readDiskEntries, readRecords, appendProgress, setStatus, writeRecord } from './journal';
import { EngineStopped, faultPorts } from './test/faultPorts';
import { tempRepo, TempRepo } from './test/tempRepo';

describe('journal', () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};
	const git = async (repo: TempRepo, args: string[]) => {
		const result = await repo.git(args);
		if (result.exitCode !== 0) {
			throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
		}
		return result.stdout.trim();
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** A process id that belonged to a process that has exited. */
	const deadPid = async (): Promise<number> => {
		const child = spawn(process.execPath, ['-e', '']);
		await new Promise(resolve => child.on('exit', resolve));
		return child.pid!;
	};

	const sampleRecord = (id: string): JournalRecord => ({
		id,
		kind: 'go-back',
		description: `Operation ${id}`,
		time: '2026-01-01T00:00:00.000Z',
		branch: 'main',
		before: { branchCommit: null, indexTree: 'i1', worktreeTree: 'w1' },
		after: { branchCommit: 'c2', indexTree: 'i2', worktreeTree: 'w2' },
		paths: [{ path: 'a.txt', before: 'b1', after: 'b2', beforeMode: '100644', afterMode: '100644' }],
		skipped: [],
		keptMoves: [],
		progress: [],
		status: 'prepared',
	});

	/**
	 * A repository at commit A (a.txt "one") with a record of an operation that moves it to
	 * commit B (a.txt "two", b.txt added), as if the operation had not started.
	 */
	const twoCommits = async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const a = await repo.commit('A');
		await repo.write('a.txt', 'two\n');
		await repo.write('b.txt', 'bee\n');
		const b = await repo.commit('B');
		await git(repo, ['reset', '--hard', a]);
		const blob = (commit: string, file: string) => git(repo, ['rev-parse', `${commit}:${file}`]);
		const tree = (commit: string) => git(repo, ['rev-parse', `${commit}^{tree}`]);
		const record: JournalRecord = {
			...sampleRecord('op-1'),
			before: { branchCommit: a, indexTree: await tree(a), worktreeTree: await tree(a) },
			after: { branchCommit: b, indexTree: await tree(b), worktreeTree: await tree(b) },
			paths: [
				{ path: 'a.txt', before: await blob(a, 'a.txt'), after: await blob(b, 'a.txt'), beforeMode: '100644', afterMode: '100644' },
				{ path: 'b.txt', before: null, after: await blob(b, 'b.txt'), beforeMode: null, afterMode: '100644' },
			],
		};
		return { repo, a, b, record };
	};

	test('second acquireLock returns undefined while the first is live', async () => {
		const repo = await create();
		const first = await acquireLock(repo.ports);
		expect(first).toBeDefined();
		expect(await acquireLock(repo.ports)).toBeUndefined();
		await first!.release();
		const third = await acquireLock(repo.ports);
		expect(third).toBeDefined();
		await third!.release();
	});

	test('a stale lock from a dead process is taken over', async () => {
		const repo = await create();
		const lockFile = `${await engineDirectory(repo.ports)}/lock`;
		await fsp.mkdir(path.dirname(lockFile), { recursive: true });
		// The process is gone, so the lock is taken over at once, whatever its age.
		await fsp.writeFile(lockFile, JSON.stringify({ pid: await deadPid(), host: os.hostname(), time: repo.ports.now().toISOString(), token: 'old' }));
		const lock = await acquireLock(repo.ports);
		expect(lock).toBeDefined();
		expect(await fsp.readFile(lockFile, 'utf8')).toContain(`"pid":${process.pid}`);
		await lock!.release();
	});

	test('a lock from a live process is kept at any age', async () => {
		const repo = await create();
		const lockFile = `${await engineDirectory(repo.ports)}/lock`;
		await fsp.mkdir(path.dirname(lockFile), { recursive: true });
		await fsp.writeFile(lockFile, JSON.stringify({ pid: process.pid, host: os.hostname(), time: repo.ports.now().toISOString(), token: 'old' }));
		repo.clock.advance(60 * 60_000);
		expect(await acquireLock(repo.ports)).toBeUndefined();
	});

	test('a lock from another host, or an unreadable lock, is taken over after 10 minutes', async () => {
		const repo = await create();
		const lockFile = `${await engineDirectory(repo.ports)}/lock`;
		await fsp.mkdir(path.dirname(lockFile), { recursive: true });
		await fsp.writeFile(lockFile, JSON.stringify({ pid: await deadPid(), host: `not-${os.hostname()}`, time: repo.ports.now().toISOString(), token: 'old' }));
		repo.clock.advance(9 * 60_000);
		expect(await acquireLock(repo.ports)).toBeUndefined();
		repo.clock.advance(2 * 60_000);
		const lock = await acquireLock(repo.ports);
		expect(lock).toBeDefined();
		await lock!.release();

		await fsp.writeFile(lockFile, '{"pid":');
		const written = new Date(repo.ports.now().getTime());
		await fsp.utimes(lockFile, written, written);
		expect(await acquireLock(repo.ports)).toBeUndefined();
		repo.clock.advance(11 * 60_000);
		expect(await acquireLock(repo.ports)).toBeDefined();
	});

	test('release leaves a lock that another holder took over', async () => {
		const repo = await create();
		const lockFile = `${await engineDirectory(repo.ports)}/lock`;
		const lock = await acquireLock(repo.ports);
		const other = JSON.stringify({ pid: process.pid, host: os.hostname(), time: repo.ports.now().toISOString(), token: 'other' });
		await fsp.writeFile(lockFile, other);
		await lock!.release();
		expect(await fsp.readFile(lockFile, 'utf8')).toBe(other);
	});

	test('readRecords returns the latest status and all progress per id', async () => {
		const repo = await create();
		await writeRecord(repo.ports, sampleRecord('op-1'));
		await writeRecord(repo.ports, sampleRecord('op-2'));
		await appendProgress(repo.ports, 'op-1', { step: 'path', path: 'a.txt' });
		await appendProgress(repo.ports, 'op-1', { step: 'index' });
		await setStatus(repo.ports, 'op-1', 'rolled-back');
		await appendProgress(repo.ports, 'op-2', { step: 'branch' });
		await setStatus(repo.ports, 'op-2', 'complete');
		await setStatus(repo.ports, 'op-2', 'abandoned');

		const records = await readRecords(repo.ports);
		expect(records.map(record => [record.id, record.status, record.progress])).toEqual([
			['op-1', 'rolled-back', [{ step: 'path', path: 'a.txt' }, { step: 'index' }]],
			['op-2', 'abandoned', [{ step: 'branch' }]],
		]);
		expect(records[0]).toEqual({ ...sampleRecord('op-1'), status: 'rolled-back', progress: records[0].progress });
	});

	test('a truncated final line is ignored', async () => {
		const repo = await create();
		await writeRecord(repo.ports, sampleRecord('op-1'));
		const journal = `${await engineDirectory(repo.ports)}/journal.jsonl`;
		// A crash in the middle of an append leaves part of a line.
		await fsp.appendFile(journal, '\n{"type":"status","id":"op-1","sta');
		expect((await readRecords(repo.ports)).map(record => record.status)).toEqual(['prepared']);

		// The next append starts on a line of its own.
		await setStatus(repo.ports, 'op-1', 'complete');
		expect((await readRecords(repo.ports)).map(record => record.status)).toEqual(['complete']);
	});

	test('readRecords returns nothing when there is no journal', async () => {
		const repo = await create();
		expect(await readRecords(repo.ports)).toEqual([]);
	});

	test('classify: untouched project is all before', async () => {
		const { repo, record } = await twoCommits();
		expect(await classify(repo.ports, record)).toEqual({
			branch: 'before',
			index: 'before',
			paths: [{ path: 'a.txt', part: 'before' }, { path: 'b.txt', part: 'before' }],
		});
	});

	test('classify: a written path is after', async () => {
		const { repo, record } = await twoCommits();
		await repo.write('a.txt', 'two\n');
		await repo.write('b.txt', 'bee\n');
		expect((await classify(repo.ports, record)).paths).toEqual([{ path: 'a.txt', part: 'after' }, { path: 'b.txt', part: 'after' }]);
	});

	test('classify: a path edited to other content is unexpected', async () => {
		const { repo, record } = await twoCommits();
		await repo.write('a.txt', 'three\n');
		await fsp.mkdir(path.join(repo.root, 'b.txt'));
		expect((await classify(repo.ports, record)).paths).toEqual([{ path: 'a.txt', part: 'unexpected' }, { path: 'b.txt', part: 'unexpected' }]);
	});

	test('classify: a changed executable bit or a link in place of a file is unexpected', async () => {
		const { repo, record } = await twoCommits();
		await fsp.chmod(path.join(repo.root, 'a.txt'), 0o755);
		await fsp.symlink('bee\n', path.join(repo.root, 'b.txt'));
		expect((await classify(repo.ports, record)).paths).toEqual([{ path: 'a.txt', part: 'unexpected' }, { path: 'b.txt', part: 'unexpected' }]);
	});

	test('classify: index with other staged content is unexpected', async () => {
		const { repo, b, record } = await twoCommits();
		await repo.write('a.txt', 'staged\n');
		await git(repo, ['add', 'a.txt']);
		expect((await classify(repo.ports, record)).index).toBe('unexpected');
		await git(repo, ['read-tree', b]);
		expect((await classify(repo.ports, record)).index).toBe('after');
	});

	test('classify: branch moved elsewhere is unexpected', async () => {
		const { repo, a, b, record } = await twoCommits();
		await git(repo, ['update-ref', 'refs/heads/main', b, a]);
		expect((await classify(repo.ports, record)).branch).toBe('after');
		await repo.write('c.txt', 'see\n');
		const other = await repo.commit('C');
		expect(other).not.toBe(b);
		expect((await classify(repo.ports, record)).branch).toBe('unexpected');
		await git(repo, ['update-ref', '-d', 'refs/heads/main']);
		expect((await classify(repo.ports, record)).branch).toBe('unexpected');
	});

	test('classify: a branch that does not exist matches a null value', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const record: JournalRecord = { ...sampleRecord('op-1'), paths: [] };
		expect((await classify(repo.ports, record)).branch).toBe('before');
	});

	test('classify: a value equal to both before and after counts as before', async () => {
		const { repo, a, record } = await twoCommits();
		const same: JournalRecord = {
			...record,
			after: { ...record.after, branchCommit: a, indexTree: record.before.indexTree },
			paths: [{ ...record.paths[0], after: record.paths[0].before, afterMode: '100644' }],
		};
		expect(await classify(repo.ports, same)).toEqual({ branch: 'before', index: 'before', paths: [{ path: 'a.txt', part: 'before' }] });
	});

	test('classify: with core.autocrlf=true a file with Windows line endings reads as its stored blob', async () => {
		const { repo, record } = await twoCommits();
		await git(repo, ['config', 'core.autocrlf', 'true']);
		await repo.write('a.txt', 'two\r\n');
		expect((await classify(repo.ports, record)).paths[0]).toEqual({ path: 'a.txt', part: 'after' });
		await repo.write('a.txt', 'two\n');
		expect((await classify(repo.ports, record)).paths[0]).toEqual({ path: 'a.txt', part: 'after' });
	});

	test('readDiskEntries reads a symbolic link as a link and an absent file as null', async () => {
		const repo = await create();
		await fsp.symlink('target.txt', path.join(repo.root, 'link'));
		await repo.write('run.sh', '#!/bin/sh\n');
		await fsp.chmod(path.join(repo.root, 'run.sh'), 0o755);
		const plan = (file: string): PathPlan => ({ path: file, before: null, after: null, beforeMode: null, afterMode: null });
		const entries = await readDiskEntries(repo.ports, [plan('link'), plan('run.sh'), plan('missing')]);
		expect(entries.get('link')).toEqual({ mode: '120000', blob: (await repo.git(['hash-object', '--stdin'], { stdin: 'target.txt' })).stdout.trim() });
		expect(entries.get('run.sh')).toEqual({ mode: '100755', blob: (await repo.git(['hash-object', '--stdin'], { stdin: '#!/bin/sh\n' })).stdout.trim() });
		expect(entries.get('missing')).toBeNull();
	});

	describe('faultPorts', () => {
		test('counts mutating calls, fails the chosen one, and stops every call from the stop point', async () => {
			const repo = await create();
			const ports = faultPorts(repo.ports, { failAt: 2, stopAt: 4 });
			await ports.files.write('a.txt', new TextEncoder().encode('a'), false);
			await expect(ports.git(['-C', repo.root, 'update-ref', 'refs/heads/x', 'HEAD'])).rejects.toThrow('injected failure');
			// Reading calls are not counted.
			await ports.git(['status']);
			await ports.files.read('a.txt');
			await ports.files.remove('a.txt');
			await expect(ports.files.move('a.txt', 'b.txt')).rejects.toBeInstanceOf(EngineStopped);
			await expect(ports.files.read('a.txt')).rejects.toBeInstanceOf(EngineStopped);
			await expect(ports.git(['status'])).rejects.toBeInstanceOf(EngineStopped);
			expect(ports.mutatingCalls.map(call => call.split(' ')[0])).toEqual(['write', 'update-ref', 'remove', 'move']);
		});
	});
});
