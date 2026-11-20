/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { EnginePorts } from './ports';
import { readRepoFacts } from './repoState';
import { tempRepo, TempRepo } from './test/tempRepo';

describe('readRepoFacts', () => {
	const repos: TempRepo[] = [];
	const create = async (options?: Parameters<typeof tempRepo>[0]) => {
		const repo = await tempRepo(options);
		repos.push(repo);
		return repo;
	};

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('a plain folder is not a project', async () => {
		const repo = await create({ init: 'none' });
		const facts = await readRepoFacts(repo.ports);
		expect(facts.isProject).toBe(false);
		expect(facts.unusual).toBeUndefined();
	});

	test('a new repository with no checkpoints is a project with no headCommit', async () => {
		const repo = await create();
		const facts = await readRepoFacts(repo.ports);
		expect(facts.isProject).toBe(true);
		expect(facts.branch).toBe('main');
		expect(facts.headCommit).toBeUndefined();
		expect(facts.unusual).toBeUndefined();
		expect(facts.gitDir).toBe(path.join(await fsp.realpath(repo.root), '.git'));
	});

	test('a repository with a commit reports headCommit', async () => {
		const repo = await create();
		await repo.write('a.txt', 'a\n');
		const id = await repo.commit('first');
		expect((await readRepoFacts(repo.ports)).headCommit).toBe(id);
	});

	test('a subfolder reports the top-level root', async () => {
		const repo = await create();
		await repo.write('sub/a.txt', 'a\n');
		await repo.commit('first');
		const ports: EnginePorts = { ...repo.ports, openedFolder: path.join(repo.root, 'sub') };
		const facts = await readRepoFacts(ports);
		expect(facts.root).toBe(await fsp.realpath(repo.root));
	});

	test('counts ahead and behind against the upstream', async () => {
		const repo = await create();
		await repo.write('a.txt', 'a\n');
		await repo.commit('first');
		const other = await repo.clone();
		repos.push(other);
		await other.write('b.txt', 'b\n');
		await other.commit('other 1');
		await other.write('c.txt', 'c\n');
		await other.commit('other 2');
		await repo.pushFrom(other);
		await repo.write('d.txt', 'd\n');
		await repo.commit('mine');
		await repo.git(['fetch']);
		const facts = await readRepoFacts(repo.ports);
		expect(facts.upstream).toBe('origin/main');
		expect(facts.ahead).toBe(1);
		expect(facts.behind).toBe(2);
	});

	test('no upstream gives upstream undefined', async () => {
		const repo = await create();
		await repo.write('a.txt', 'a\n');
		await repo.commit('first');
		const facts = await readRepoFacts(repo.ports);
		expect(facts.upstream).toBeUndefined();
		expect(facts.ahead).toBe(0);
		expect(facts.behind).toBe(0);
	});

	test.each(['user.name', 'user.email'])('missing %s sets identityMissing', async key => {
		const repo = await create();
		expect((await readRepoFacts(repo.ports)).identityMissing).toBe(false);
		await repo.git(['config', '--unset', key]);
		expect((await readRepoFacts(repo.ports)).identityMissing).toBe(true);
	});

	test.each(['MERGE_HEAD', 'rebase-merge', 'CHERRY_PICK_HEAD'])('%s gives operation-in-progress', async name => {
		const repo = await create();
		await repo.write('a.txt', 'a\n');
		await repo.commit('first');
		const gitDir = path.join(repo.root, '.git');
		if (name === 'rebase-merge') {
			await fsp.mkdir(path.join(gitDir, name));
		} else {
			await fsp.writeFile(path.join(gitDir, name), 'abc\n');
		}
		const facts = await readRepoFacts(repo.ports);
		expect(facts.unusual?.kind).toBe('operation-in-progress');
		expect(facts.unusual?.detail).toContain(name);
	});

	test('detached HEAD gives detached', async () => {
		const repo = await create();
		await repo.write('a.txt', 'a\n');
		const id = await repo.commit('first');
		await repo.git(['checkout', '--detach', id]);
		const facts = await readRepoFacts(repo.ports);
		expect(facts.unusual?.kind).toBe('detached');
		expect(facts.branch).toBeUndefined();
		expect(facts.headCommit).toBe(id);
	});

	test('staged content that differs from disk gives staged-differs', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.commit('first');
		await repo.write('a.txt', 'two\n');
		await repo.git(['add', 'a.txt']);
		await repo.write('a.txt', 'three\n');
		const facts = await readRepoFacts(repo.ports);
		expect(facts.unusual?.kind).toBe('staged-differs');
		expect(facts.unusual?.detail).toContain('a.txt');
	});

	test('staged content equal to disk is not unusual', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.commit('first');
		await repo.write('a.txt', 'two\n');
		await repo.git(['add', 'a.txt']);
		expect((await readRepoFacts(repo.ports)).unusual).toBeUndefined();
	});

	test('syncAvailable is true when merge-tree supports --merge-base', async () => {
		const repo = await create();
		expect((await readRepoFacts(repo.ports)).syncAvailable).toBe(true);
	});

	test('syncAvailable is false when merge-tree lacks --merge-base', async () => {
		const repo = await create();
		const ports: EnginePorts = {
			...repo.ports,
			git: (args, options) => args.includes('merge-tree') && args.includes('-h')
				? Promise.resolve({ stdout: 'usage: git merge-tree [--write-tree] <branch1> <branch2>\n', stderr: '', exitCode: 129, timedOut: false })
				: repo.ports.git(args, options),
		};
		expect((await readRepoFacts(ports)).syncAvailable).toBe(false);
	});

	test('a runner that fails to start gives git-missing', async () => {
		const repo = await create();
		const ports: EnginePorts = {
			...repo.ports,
			git: () => Promise.resolve({ stdout: '', stderr: 'Error: spawn git ENOENT', exitCode: -1, timedOut: false }),
		};
		const facts = await readRepoFacts(ports);
		expect(facts.isProject).toBe(false);
		expect(facts.unusual?.kind).toBe('git-missing');
	});
});
