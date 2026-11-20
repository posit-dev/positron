/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createGitRunner, GitFailedError, GitMissingError, GitTimeoutError, mustGit, runGit, splitZ } from './git';
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

	test('ignores GIT_DIR, GIT_INDEX_FILE, and the other repository variables of the parent', async () => {
		const names = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES'];
		const saved = names.map(name => process.env[name]);
		const other = await tempRepo();
		try {
			for (const name of names) {
				process.env[name] = path.join(other.root, '.git');
			}
			const git = createGitRunner('git', repo.root);
			const top = await git(['rev-parse', '--show-toplevel']);
			expect(path.resolve(top.stdout.trim())).toBe(await fsp.realpath(repo.root));
			const echoed = await git(['-c', 'alias.e=!echo "$GIT_DIR$GIT_INDEX_FILE"', 'e']);
			expect(echoed.stdout.trim()).toBe('');
			const own = await git(['-c', 'alias.e=!echo $GIT_INDEX_FILE', 'e'], { env: { GIT_INDEX_FILE: '/own/index' } });
			expect(own.stdout.trim()).toBe('/own/index');
		} finally {
			names.forEach((name, i) => {
				if (saved[i] === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = saved[i];
				}
			});
			await other.dispose();
		}
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

	test('a time-out reports timedOut even when the process exits while it is stopped', async () => {
		const results = await Promise.all([1, 2, 3, 4, 5].map(() =>
			createGitRunner('git', repo.root)(['-c', 'alias.s=!sleep 5', 's'], { timeoutMs: 100 })));
		expect(results.map(result => result.timedOut)).toEqual([true, true, true, true, true]);
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

	test('stdoutToFile streams a 20 MB blob to the file and returns an empty stdout', async () => {
		const bytes = Buffer.alloc(20 * 1024 * 1024);
		for (let index = 0; index < bytes.length; index++) {
			bytes[index] = (index * 7 + (index >> 12)) & 0xff;
		}
		const hash = (await repo.git(['hash-object', '-w', '--stdin'], { stdin: bytes })).stdout.trim();
		const file = path.join(repo.root, 'out.bin');
		await fsp.writeFile(file, 'old content that is replaced');

		const result = await repo.git(['cat-file', 'blob', hash], { stdoutToFile: file });

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('');
		expect(Buffer.compare(await fsp.readFile(file), bytes)).toBe(0);
	});

	test('stdoutToFile rejects when the file cannot be opened', async () => {
		await expect(repo.git(['--version'], { stdoutToFile: path.join(repo.root, 'missing-folder', 'out.txt') })).rejects.toThrow(/ENOENT/);
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

describe('mustGit', () => {
	const fake = (exitCode: number, stderr = '') => () => Promise.resolve({ stdout: 'out', stderr, exitCode, timedOut: false });

	test('returns the result of a successful command', async () => {
		await expect(mustGit(fake(0), ['status'])).resolves.toMatchObject({ stdout: 'out' });
	});

	test('throws GitFailedError with the arguments, exit code, and stderr on a non-zero exit', async () => {
		const error = await mustGit(fake(128, 'fatal: bad\n'), ['diff', '--cached']).catch(e => e);
		expect(error).toBeInstanceOf(GitFailedError);
		expect(error).toMatchObject({ args: ['diff', '--cached'], exitCode: 128, stderr: 'fatal: bad\n' });
	});

	test('still throws the time-out and missing-git errors', async () => {
		await expect(mustGit(() => Promise.resolve({ stdout: '', stderr: '', exitCode: -1, timedOut: true }), ['status']))
			.rejects.toBeInstanceOf(GitTimeoutError);
		await expect(mustGit(() => Promise.resolve({ stdout: '', stderr: 'x', exitCode: -1, timedOut: false }), ['status']))
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
