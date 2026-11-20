/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGitRunner, GitMissingError, GitTimeoutError, runGit, splitZ } from './git';
import { tempRepo, TempRepo } from './test/tempRepo';

describe('createGitRunner', () => {
	let repo: TempRepo;

	beforeEach(async () => {
		repo = await tempRepo();
	});

	afterEach(async () => {
		await repo.dispose();
	});

	test('runs git and returns stdout', async () => {
		const result = await repo.git(['rev-parse', '--is-inside-work-tree']);
		expect(result.exitCode).toBe(0);
		expect(result.timedOut).toBe(false);
		expect(result.stdout.trim()).toBe('true');
	});

	test('reports a failing command through exitCode and stderr', async () => {
		const result = await repo.git(['rev-parse', '--verify', 'no-such-ref']);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).not.toBe('');
	});

	test('sets GIT_TERMINAL_PROMPT=0', async () => {
		const result = await createGitRunner('git', repo.root)(['-c', 'alias.e=!echo $GIT_TERMINAL_PROMPT', 'e'], {
			env: { GIT_TERMINAL_PROMPT: '1' },
		});
		expect(result.stdout.trim()).toBe('0');
	});

	test('sets LC_ALL=C and GIT_OPTIONAL_LOCKS=0', async () => {
		const result = await createGitRunner('git', repo.root)(['-c', 'alias.e=!echo $LC_ALL $GIT_OPTIONAL_LOCKS', 'e']);
		expect(result.stdout.trim()).toBe('C 0');
	});

	test('a call that exceeds timeoutMs returns timedOut', async () => {
		const started = Date.now();
		const result = await createGitRunner('git', repo.root)(['-c', 'alias.s=!sleep 5', 's'], { timeoutMs: 200 });
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	test('passes stdin to git', async () => {
		const result = await repo.git(['hash-object', '--stdin'], { stdin: 'hello\n' });
		expect(result.stdout.trim()).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
	});

	test('binary output round-trips through latin1', async () => {
		const bytes = Uint8Array.from([0, 1, 2, 200, 255, 10]);
		const hash = (await repo.git(['hash-object', '-w', '--stdin'], { stdin: bytes })).stdout.trim();
		const result = await repo.git(['cat-file', 'blob', hash], { binary: true });
		expect(Array.from(Buffer.from(result.stdout, 'latin1'))).toEqual(Array.from(bytes));
	});

	test('a missing git executable resolves with a failure', async () => {
		const result = await createGitRunner(path.join(os.tmpdir(), 'no-such-git-binary'), repo.root)(['status']);
		expect(result.exitCode).toBe(-1);
		expect(result.timedOut).toBe(false);
	});
});

describe('runGit', () => {
	test('returns the result of a successful or failing command', async () => {
		const repo = await tempRepo();
		try {
			expect((await runGit(repo.git, ['rev-parse', '--is-inside-work-tree'])).stdout.trim()).toBe('true');
			expect((await runGit(repo.git, ['rev-parse', '--verify', 'no-such-ref'])).exitCode).not.toBe(0);
		} finally {
			await repo.dispose();
		}
	});

	test('throws GitTimeoutError when the call timed out', async () => {
		await expect(runGit(() => Promise.resolve({ stdout: '', stderr: '', exitCode: -1, timedOut: true }), ['status']))
			.rejects.toBeInstanceOf(GitTimeoutError);
	});

	test('throws GitMissingError when the process could not start', async () => {
		await expect(runGit(() => Promise.resolve({ stdout: '', stderr: 'spawn git ENOENT', exitCode: -1, timedOut: false }), ['status']))
			.rejects.toMatchObject({ name: 'GitMissingError', detail: 'spawn git ENOENT' });
		await expect(runGit(() => Promise.resolve({ stdout: '', stderr: '', exitCode: -1, timedOut: false }), ['status']))
			.rejects.toBeInstanceOf(GitMissingError);
	});
});

describe('splitZ', () => {
	test('splitZ handles names with spaces and newlines', () => {
		expect(splitZ('a b.txt\0line\nbreak.txt\0')).toEqual(['a b.txt', 'line\nbreak.txt']);
		expect(splitZ('one\0two')).toEqual(['one', 'two']);
		expect(splitZ('')).toEqual([]);
	});
});

describe('tempRepo', () => {
	test('creates the repository under the temporary directory with a local identity', async () => {
		const repo = await tempRepo();
		try {
			expect(await fsp.realpath(repo.root)).toContain(await fsp.realpath(os.tmpdir()));
			expect((await repo.git(['config', '--local', 'user.name'])).stdout.trim()).toBe('Test User');
			expect((await repo.git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim()).toBe('main');
			expect([repo.ports.newId(), repo.ports.newId()]).toEqual(['op-1', 'op-2']);
			const before = repo.ports.now().getTime();
			repo.clock.advance(1000);
			expect(repo.ports.now().getTime() - before).toBe(1000);
		} finally {
			await repo.dispose();
		}
	});

	test('tempRepo clone and pushFrom exchange commits', async () => {
		const first = await tempRepo();
		await first.write('a.txt', 'one\n');
		await first.commit('first');
		const second = await first.clone();
		try {
			expect(await second.read('a.txt')).toBe('one\n');

			await second.write('b.txt', 'two\n');
			const secondCommit = await second.commit('second');
			await first.pushFrom(second);

			expect(await first.ports.network.fetch()).toEqual({ ok: true });
			const remoteHead = (await first.git(['rev-parse', 'origin/main'])).stdout.trim();
			expect(remoteHead).toBe(secondCommit);

			await first.git(['merge', '--ff-only', 'origin/main']);
			expect(await first.read('b.txt')).toBe('two\n');

			await first.write('c.txt', 'three\n');
			await first.commit('third');
			expect(await first.ports.network.push('main')).toEqual({ ok: true });
			expect(await second.ports.network.fetch()).toEqual({ ok: true });
			expect((await second.git(['log', '--format=%s', 'origin/main'])).stdout.trim().split('\n')).toEqual(['third', 'second', 'first']);
		} finally {
			await second.dispose();
			await first.dispose();
		}
	});

	test('disposing a clone leaves the original repository and the shared remote', async () => {
		const first = await tempRepo();
		await first.write('a.txt', 'one\n');
		await first.commit('first');
		const second = await first.clone();
		try {
			await second.dispose();
			expect(await first.read('a.txt')).toBe('one\n');
			expect((await first.git(['ls-remote', 'origin'])).exitCode).toBe(0);
		} finally {
			await first.dispose();
		}
	});

	test('a push the shared copy cannot take in order is rejected as moved', async () => {
		const first = await tempRepo();
		await first.write('a.txt', 'one\n');
		await first.commit('first');
		const second = await first.clone();
		try {
			await second.write('b.txt', 'two\n');
			await second.commit('second');
			await first.pushFrom(second);

			await first.write('c.txt', 'three\n');
			await first.commit('third');
			const result = await first.ports.network.push('main');
			expect(result).toMatchObject({ ok: false, reason: 'shared-copy-moved' });
		} finally {
			await second.dispose();
			await first.dispose();
		}
	});
});
