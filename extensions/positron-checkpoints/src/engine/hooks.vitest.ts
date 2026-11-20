/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { buildCandidate, CandidateResult } from './hooks';
import { GitRunner } from './ports';
import { must, treeWith } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { worktreeTree } from './trees';

// Each test runs git hooks, which exceed the default limit under a loaded test run.
describe.skipIf(process.platform === 'win32')('buildCandidate', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** A project with a.txt and b.txt committed, a.txt edited, and the tree that takes the edit. */
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('b.txt', 'bee\n');
		const parent = await repo.commit('A');
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		const approvedTree = await treeWith(repo, await must(repo, ['rev-parse', 'HEAD^{tree}']), { 'a.txt': 'two\n' });
		return { repo, input: { parent, approvedTree, title: 'Edit a', body: 'Changed one to two.' } };
	};

	/** Installs an executable shell hook. */
	const hook = async (repo: TempRepo, name: string, script: string) => {
		const file = path.join(repo.root, '.git', 'hooks', name);
		await fsp.mkdir(path.dirname(file), { recursive: true });
		await fsp.writeFile(file, `#!/bin/sh\n${script}\n`);
		await fsp.chmod(file, 0o755);
	};

	/** The branch, the real index, and the files in the index, which no case may change. */
	const fixedParts = async (repo: TempRepo) => [
		await must(repo, ['rev-parse', 'refs/heads/main']),
		await must(repo, ['write-tree']),
		await must(repo, ['ls-files', '-s']),
	];

	test('a repository with no hooks gives ok and equal trees', async () => {
		const { repo, input } = await create();

		const result = await buildCandidate(repo.ports, input);

		expect(result).toMatchObject({ outcome: 'ok', output: '', approvedTree: input.approvedTree, resultTree: input.approvedTree, message: 'Edit a\n\nChanged one to two.\n', hookEdited: [] });
		expect(await must(repo, ['rev-parse', `${result.candidate}^{tree}`])).toBe(input.approvedTree);
		expect(await must(repo, ['rev-parse', `${result.candidate}^`])).toBe(input.parent);
		expect(await must(repo, ['log', '-1', '--format=%B', result.candidate!])).toBe('Edit a\n\nChanged one to two.');
	});

	test('a failing pre-commit gives rejected with its output and no candidate', async () => {
		const { repo, input } = await create();
		await hook(repo, 'pre-commit', 'echo "lint found 2 problems"\necho "on stderr" >&2\nexit 1');

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('rejected');
		expect(result.candidate).toBeUndefined();
		expect(result.output).toContain('lint found 2 problems');
		expect(result.output).toContain('on stderr');
	});

	test('a pre-commit that stages another file gives a different resultTree', async () => {
		const { repo, input } = await create();
		await hook(repo, 'pre-commit', 'git add other.txt');

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('ok');
		expect(result.resultTree).not.toBe(input.approvedTree);
		expect(await must(repo, ['ls-tree', '--name-only', result.resultTree])).toBe('a.txt\nb.txt\nother.txt');
		expect(await must(repo, ['rev-parse', `${result.candidate}^{tree}`])).toBe(result.resultTree);
	});

	test('prepare-commit-msg changes the message', async () => {
		const { repo, input } = await create();
		await hook(repo, 'prepare-commit-msg', 'test "$2" = message || exit 1\nmsg=$(cat "$1")\nprintf \'[TICKET-1] %s\\n\' "$msg" > "$1"');

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('ok');
		expect(result.message.startsWith('[TICKET-1] ')).toBe(true);
		expect(await must(repo, ['log', '-1', '--format=%s', result.candidate!])).toBe('[TICKET-1] Edit a');
	});

	test('hooks run in the order pre-commit, prepare-commit-msg, commit-msg', async () => {
		const { repo, input } = await create();
		const log = path.join(path.dirname(repo.root), 'hook-log.txt');
		for (const name of ['commit-msg', 'prepare-commit-msg', 'pre-commit']) {
			await hook(repo, name, `echo ${name} >> "${log}"`);
		}

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('ok');
		expect(await fsp.readFile(log, 'utf8')).toBe('pre-commit\nprepare-commit-msg\ncommit-msg\n');
	});

	test('a failing commit-msg gives rejected with no candidate', async () => {
		const { repo, input } = await create();
		await hook(repo, 'commit-msg', 'echo "message needs a ticket"\nexit 1');

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('rejected');
		expect(result.candidate).toBeUndefined();
		expect(result.output).toContain('message needs a ticket');
	});

	test('a message that is empty after the hooks gives rejected', async () => {
		const { repo, input } = await create();
		await hook(repo, 'commit-msg', ': > "$1"');

		const result = await buildCandidate(repo.ports, input);

		expect(result).toMatchObject({ outcome: 'rejected', message: '' });
		expect(result.candidate).toBeUndefined();
	});

	test('hooks run in the project root with the temporary index', async () => {
		const { repo, input } = await create();
		const log = path.join(path.dirname(repo.root), 'hook-log.txt');
		await hook(repo, 'pre-commit', `pwd > "${log}"\ngit diff --cached --name-only >> "${log}"`);

		await buildCandidate(repo.ports, input);

		expect(await fsp.readFile(log, 'utf8')).toBe(`${await fsp.realpath(repo.root)}\na.txt\n`);
	});

	test('a formatter hook that rewrites a working file is reported in hookEdited', async () => {
		const { repo, input } = await create();
		await hook(repo, 'pre-commit', 'printf \'formatted\\n\' > b.txt');
		const before = await must(repo, ['hash-object', '-w', '--', 'b.txt']);

		const result = await buildCandidate(repo.ports, input);

		const after = await must(repo, ['hash-object', '--stdin'], { stdin: 'formatted\n' });
		expect(result.hookEdited).toEqual([{ path: 'b.txt', before, after, beforeMode: '100644', afterMode: '100644' }]);
		expect(await repo.read('b.txt')).toBe('formatted\n');
	});

	test('a rejecting hook that rewrites a working file still reports it', async () => {
		const { repo, input } = await create();
		await hook(repo, 'pre-commit', 'printf \'formatted\\n\' > b.txt\nrm other.txt\nexit 1');

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('rejected');
		expect(result.hookEdited.map(plan => [plan.path, plan.after === null])).toEqual([['b.txt', false], ['other.txt', true]]);
	});

	test('the branch and the real index are unchanged in every case', async () => {
		const { repo, input } = await create();
		await repo.git(['add', 'a.txt']);
		const before = await fixedParts(repo);
		const cases = [
			'exit 0',
			'echo no\nexit 1',
			'git add other.txt',
			'printf \'formatted\\n\' > b.txt',
		];
		const outcomes: CandidateResult['outcome'][] = [];
		for (const script of cases) {
			await hook(repo, 'pre-commit', script);
			outcomes.push((await buildCandidate(repo.ports, input)).outcome);
			expect(await fixedParts(repo)).toEqual(before);
		}
		expect(outcomes).toEqual(['ok', 'rejected', 'ok', 'ok']);
	});

	test('an edit the person made before the hooks ran is not attributed to them', async () => {
		const { repo, input } = await create();
		await repo.write('other.txt', 'edited by the person\n');
		await hook(repo, 'pre-commit', 'printf \'formatted\\n\' > b.txt');

		const result = await buildCandidate(repo.ports, input);

		expect(result.hookEdited.map(plan => plan.path)).toEqual(['b.txt']);
	});

	test('a given baselineTree is what edits are measured from', async () => {
		const { repo, input } = await create();
		const baselineTree = (await worktreeTree(repo.ports)).tree;
		await repo.write('other.txt', 'edited by an earlier hook\n');
		await hook(repo, 'pre-commit', 'printf \'formatted\\n\' > b.txt');

		const result = await buildCandidate(repo.ports, { ...input, baselineTree });

		expect(result.baselineTree).toBe(baselineTree);
		expect(result.hookEdited.map(plan => plan.path)).toEqual(['b.txt', 'other.txt']);
	});

	test('a hook that replaces a file with a folder, or a folder with a file, is reported', async () => {
		const { repo, input } = await create();
		await repo.write('d/x.txt', 'in a folder\n');
		await must(repo, ['add', 'd/x.txt']);
		await hook(repo, 'pre-commit', 'rm b.txt\nmkdir b.txt\necho inner > b.txt/inner.txt\nrm -r d\necho file > d');

		const result = await buildCandidate(repo.ports, input);

		expect(result.hookEdited.map(plan => [plan.path, plan.before !== null, plan.after !== null])).toEqual([
			['b.txt', true, false], ['b.txt/inner.txt', false, true], ['d', false, true], ['d/x.txt', true, false],
		]);
	});

	test('hooks read the message from COMMIT_EDITMSG with GIT_EDITOR set to ":", and the file is put back', async () => {
		const { repo, input } = await create();
		const editMessage = path.join(repo.root, '.git', 'COMMIT_EDITMSG');
		await fsp.writeFile(editMessage, 'an earlier message\n');
		const log = path.join(path.dirname(repo.root), 'hook-log.txt');
		await hook(repo, 'commit-msg', `cat .git/COMMIT_EDITMSG > "${log}"\necho "editor=$GIT_EDITOR" >> "${log}"\ntest "$1" -ef .git/COMMIT_EDITMSG || exit 1`);

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('ok');
		expect(await fsp.readFile(log, 'utf8')).toBe('Edit a\n\nChanged one to two.\neditor=:\n');
		expect(await fsp.readFile(editMessage, 'utf8')).toBe('an earlier message\n');
	});

	test('COMMIT_EDITMSG is removed afterwards when it did not exist', async () => {
		const { repo, input } = await create();
		// `git commit` in the test setup wrote one.
		await fsp.rm(path.join(repo.root, '.git', 'COMMIT_EDITMSG'));

		expect((await buildCandidate(repo.ports, input)).outcome).toBe('ok');

		await expect(fsp.stat(path.join(repo.root, '.git', 'COMMIT_EDITMSG'))).rejects.toThrow();
	});

	test('commit.gpgsign=true passes -S', async () => {
		const { repo, input } = await create();
		await repo.git(['config', 'commit.gpgsign', 'true']);
		const calls: string[][] = [];
		const git: GitRunner = async (args, options) => {
			if (args.includes('commit-tree')) {
				calls.push(args);
				// No signing key exists in the test; the real call runs unsigned.
				return repo.ports.git(args.filter(arg => arg !== '-S'), options);
			}
			return repo.ports.git(args, options);
		};

		const result = await buildCandidate({ ...repo.ports, git }, input);

		expect(result.outcome).toBe('ok');
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain('-S');
		expect(calls[0]).not.toContain('--no-gpg-sign');
	});

	test('a signing failure gives rejected with git\'s error text', async () => {
		const { repo, input } = await create();
		await repo.git(['config', 'commit.gpgsign', 'true']);
		await repo.git(['config', 'gpg.program', 'false']);

		const result = await buildCandidate(repo.ports, input);

		expect(result.outcome).toBe('rejected');
		expect(result.candidate).toBeUndefined();
		expect(result.output).toMatch(/gpg failed to sign/);
	});

	test('a hook that does not finish in time gives rejected with a clear line', async () => {
		const { repo, input } = await create();
		const git: GitRunner = async (args, options) => args.includes('hook') && args.includes('pre-commit')
			? { stdout: '', stderr: '', exitCode: -1, timedOut: true }
			: repo.ports.git(args, options);

		const result = await buildCandidate({ ...repo.ports, git }, input);

		expect(result.outcome).toBe('rejected');
		expect(result.candidate).toBeUndefined();
		expect(result.output).toMatch(/did not finish within 10 minutes/);
	});
});
