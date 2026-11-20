/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import { acceptCheckedCheckpoint, createCheckpoints } from './checkpoints';
import { getHistory } from './history';
import { readOperationLog, redoHead, undoHead } from './operationLog';
import { readRepoFacts } from './repoState';
import { FIRST_CHECKPOINT_TITLE, proposedGitignore, startTracking } from './startTracking';
import { must } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { LARGE_FILE_BYTES } from './trees';

describe('startTracking', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	const identity = { name: 'Ada Lovelace', email: 'ada@example.com' };

	/** A plain folder (not a repository) with an R script and a data file in a subfolder. */
	const plainFolder = async () => {
		const repo = await tempRepo({ init: 'none' });
		repos.push(repo);
		await repo.write('analysis.R', 'x <- 1\n');
		await repo.write('data/raw.csv', 'a,b\n1,2\n');
		return repo;
	};

	const files = async (repo: TempRepo) => (await must(repo, ['ls-tree', '-r', '--name-only', 'HEAD'])).split('\n');

	test('a plain folder becomes a project with one checkpoint', async () => {
		const repo = await plainFolder();
		expect((await readRepoFacts(repo.ports)).isProject).toBe(false);

		const result = await startTracking(repo.ports, identity, await proposedGitignore(repo.ports));

		expect(result).toMatchObject({ kind: 'done', hookEditedFiles: [] });
		expect((await readRepoFacts(repo.ports))).toMatchObject({ isProject: true, branch: 'main', unusual: undefined });
		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.title, checkpoint.authorName])).toEqual([[FIRST_CHECKPOINT_TITLE, 'Ada Lovelace']]);
		expect(await files(repo)).toEqual(['.gitignore', 'analysis.R', 'data/raw.csv']);
		expect((await readChanges(repo.ports)).files).toEqual([]);
		expect(await must(repo, ['write-tree'])).toBe(await must(repo, ['rev-parse', 'HEAD^{tree}']));
		expect(await repo.read('.gitignore')).toContain('.Rhistory\n');
	});

	test('identity is required when git has none', async () => {
		const repo = await plainFolder();

		const missing = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'identity-missing' };
		expect(await startTracking(repo.ports)).toEqual(missing);
		expect(await startTracking(repo.ports, { name: ' ', email: 'ada@example.com' })).toEqual(missing);
		expect(await startTracking(repo.ports, { name: 'Ada', email: '<ada@example.com>' })).toEqual(missing);
		expect((await readRepoFacts(repo.ports)).isProject).toBe(false);
		expect(await fsp.readdir(repo.root)).toEqual(['analysis.R', 'data']);
	});

	test('an identity git already has is used', async () => {
		const repo = await plainFolder();
		const withIdentity = {
			...repo.ports,
			git: (args: string[], options?: Parameters<typeof repo.ports.git>[1]) => repo.ports.git(args, {
				...options,
				env: { GIT_AUTHOR_NAME: 'Grace', GIT_AUTHOR_EMAIL: 'grace@example.com', GIT_COMMITTER_NAME: 'Grace', GIT_COMMITTER_EMAIL: 'grace@example.com', ...options?.env },
			}),
		};

		expect(await startTracking(withIdentity)).toMatchObject({ kind: 'done' });
		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => checkpoint.authorName)).toEqual(['Grace']);
		expect((await repo.git(['config', '--local', '--get', 'user.name'])).exitCode).not.toBe(0);
	});

	test('given identity is stored for this project only', async () => {
		const repo = await plainFolder();

		await startTracking(repo.ports, identity);

		expect([await must(repo, ['config', '--local', 'user.name']), await must(repo, ['config', '--local', 'user.email'])]).toEqual([identity.name, identity.email]);
		// Test repositories read no global configuration, so this is the only place it can be.
		expect((await repo.git(['config', '--global', '--get', 'user.name'])).exitCode).not.toBe(0);
	});

	test('an existing .gitignore is not replaced', async () => {
		const repo = await plainFolder();
		await repo.write('.gitignore', '*.csv\n');

		expect(await startTracking(repo.ports, identity, 'proposed\n')).toMatchObject({ kind: 'done' });

		expect(await repo.read('.gitignore')).toBe('*.csv\n');
		expect(await files(repo)).toEqual(['.gitignore', 'analysis.R']);
	});

	test('a file over 50 MB is in the proposed ignore list and not in the checkpoint', async () => {
		const repo = await plainFolder();
		await repo.write('results/big run#1.bin', '');
		await fsp.truncate(path.join(repo.root, 'results', 'big run#1.bin'), LARGE_FILE_BYTES + 1);
		// A large file the proposed patterns already leave out is not listed again.
		await repo.write('.venv/big.bin', '');
		await fsp.truncate(path.join(repo.root, '.venv', 'big.bin'), LARGE_FILE_BYTES + 1);

		const proposed = await proposedGitignore(repo.ports);
		const [lastLine] = proposed.trimEnd().split('\n').slice(-1);
		expect(lastLine).toBe('/results/big run\\#1.bin');
		expect(proposed.split('\n').filter(line => line.includes('big'))).toEqual([lastLine]);
		expect(await fsp.readdir(repo.root)).toEqual(['.venv', 'analysis.R', 'data', 'results']);

		expect(await startTracking(repo.ports, identity)).toMatchObject({ kind: 'done' });
		expect(await files(repo)).toEqual(['analysis.R', 'data/raw.csv']);
		expect((await fsp.stat(path.join(repo.root, 'results', 'big run#1.bin'))).size).toBe(LARGE_FILE_BYTES + 1);
	});

	test('with the proposed ignore list, the large file is ignored', async () => {
		const repo = await plainFolder();
		await repo.write('big.bin', '');
		await fsp.truncate(path.join(repo.root, 'big.bin'), LARGE_FILE_BYTES + 1);

		expect(await startTracking(repo.ports, identity, await proposedGitignore(repo.ports))).toMatchObject({ kind: 'done' });

		expect(await must(repo, ['check-ignore', 'big.bin'])).toBe('big.bin');
		expect((await readChanges(repo.ports)).files).toEqual([]);
	});

	test('start-tracking is not undoable', async () => {
		const repo = await plainFolder();

		const result = await startTracking(repo.ports, identity);

		expect(await undoHead(repo.ports)).toBeUndefined();
		expect(await redoHead(repo.ports)).toBeUndefined();
		const log = await readOperationLog(repo.ports);
		expect(log.map(entry => [entry.record.kind, entry.expired])).toEqual([['create-checkpoints', true], ['start-tracking', true]]);
		expect(result.kind === 'done' && result.operationId).toBe(log[1].record.id);
	});

	test('an empty folder becomes a project with no checkpoints', async () => {
		const repo = await tempRepo({ init: 'none' });
		repos.push(repo);

		expect(await startTracking(repo.ports, identity)).toMatchObject({ kind: 'done' });

		expect(await readRepoFacts(repo.ports)).toMatchObject({ isProject: true, headCommit: undefined });
		expect(await getHistory(repo.ports, 0, 10)).toEqual([]);
	});

	test.skipIf(process.platform === 'win32')('a first checkpoint a hook rejects leaves a project with no checkpoints', async () => {
		const repo = await plainFolder();
		const hooks = path.join(path.dirname(repo.root), 'hooks');
		await fsp.mkdir(hooks);
		await fsp.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "not today"\nexit 1\n', { mode: 0o755 });
		const withHooks = { ...repo.ports, git: (args: string[], options?: Parameters<typeof repo.ports.git>[1]) => repo.ports.git(['-c', `core.hooksPath=${hooks}`, ...args], options) };

		const result = await startTracking(withHooks, identity);

		expect(result).toMatchObject({ kind: 'check-failed', output: 'not today' });
		expect(await readRepoFacts(repo.ports)).toMatchObject({ isProject: true, headCommit: undefined });
		expect(await undoHead(repo.ports)).toBeUndefined();
	});

	test.skipIf(process.platform === 'win32')('a start whose first checkpoint a hook rejected runs again', async () => {
		const repo = await plainFolder();
		const hooks = path.join(path.dirname(repo.root), 'hooks');
		await fsp.mkdir(hooks);
		await fsp.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho "not today"\nexit 1\n', { mode: 0o755 });
		const withHooks = { ...repo.ports, git: (args: string[], options?: Parameters<typeof repo.ports.git>[1]) => repo.ports.git(['-c', `core.hooksPath=${hooks}`, ...args], options) };
		expect(await startTracking(withHooks, identity, 'proposed\n')).toMatchObject({ kind: 'check-failed' });
		await fsp.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

		// The identity and the ignore file are already in place, so neither is needed again.
		const result = await startTracking(withHooks);

		expect(result).toMatchObject({ kind: 'done' });
		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.title, checkpoint.authorName])).toEqual([[FIRST_CHECKPOINT_TITLE, 'Ada Lovelace']]);
		expect(await files(repo)).toEqual(['.gitignore', 'analysis.R', 'data/raw.csv']);
		expect(await repo.read('.gitignore')).toBe('proposed\n');
		expect([await undoHead(repo.ports), await redoHead(repo.ports)]).toEqual([undefined, undefined]);
		const log = await readOperationLog(repo.ports);
		expect(result.kind === 'done' && result.operationId).toBe(log[log.length - 1].record.id);
		expect(await startTracking(withHooks)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'already-tracking' });
	});

	test.skipIf(process.platform === 'win32')('a first checkpoint held for approval and accepted later is not undoable', async () => {
		const repo = await plainFolder();
		const hooks = path.join(path.dirname(repo.root), 'hooks');
		await fsp.mkdir(hooks);
		// The hook adds a file of its own, which changes the checkpoint.
		await fsp.writeFile(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho made > made.txt\ngit add made.txt\n', { mode: 0o755 });
		const withHooks = { ...repo.ports, git: (args: string[], options?: Parameters<typeof repo.ports.git>[1]) => repo.ports.git(['-c', `core.hooksPath=${hooks}`, ...args], options) };

		const held = await startTracking(withHooks, identity);
		if (held.kind !== 'check-changed-checkpoint') {
			throw new Error(`the first checkpoint was not held: ${JSON.stringify(held)}`);
		}
		expect(await readRepoFacts(repo.ports)).toMatchObject({ isProject: true, headCommit: undefined });

		expect(await acceptCheckedCheckpoint(withHooks, held.token)).toMatchObject({ kind: 'done' });

		expect(await files(repo)).toEqual(['analysis.R', 'data/raw.csv', 'made.txt']);
		expect([await undoHead(repo.ports), await redoHead(repo.ports)]).toEqual([undefined, undefined]);
		expect((await readOperationLog(repo.ports)).map(entry => entry.record.kind).slice(-1)).toEqual(['start-tracking']);
	});

	test('a repository with no checkpoints, made by another tool on another branch name, can start', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await must(repo, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
		await repo.write('analysis.R', 'x <- 1\n');

		expect(await startTracking(repo.ports, undefined, 'proposed\n')).toMatchObject({ kind: 'done' });

		expect(await readRepoFacts(repo.ports)).toMatchObject({ branch: 'trunk' });
		expect(await files(repo)).toEqual(['.gitignore', 'analysis.R']);
		expect(await undoHead(repo.ports)).toBeUndefined();
	});

	test('a first checkpoint created directly in a repository with none is not undoable', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('analysis.R', 'x <- 1\n');

		const created = await createCheckpoints(repo.ports, (await readChanges(repo.ports)).basis, [{ title: 'First', body: '', hunkIds: [], wholeFiles: ['analysis.R'] }]);

		expect(created).toMatchObject({ kind: 'done' });
		expect(await undoHead(repo.ports)).toBeUndefined();
		expect((await readOperationLog(repo.ports)).map(entry => entry.record.kind)).toEqual(['create-checkpoints', 'start-tracking']);
	});

	test('a repository nested in the folder is in the proposed ignore list and not in the first checkpoint', async () => {
		const repo = await plainFolder();
		// One nested repository has a commit, and one has none.
		const nested = await tempRepo();
		repos.push(nested);
		await nested.write('x.txt', 'x\n');
		const nestedHead = await nested.commit('Nested');
		await fsp.mkdir(path.join(repo.root, 'tools'));
		await fsp.rename(nested.root, path.join(repo.root, 'tools', 'lib'));
		await repo.write('empty/.keep', '');
		await must(repo, ['-C', path.join(repo.root, 'empty'), 'init', '-q']);

		const proposed = await proposedGitignore(repo.ports);
		expect(proposed.trimEnd().split('\n').slice(-2)).toEqual(['/empty/', '/tools/lib/']);

		expect(await startTracking(repo.ports, identity, proposed)).toMatchObject({ kind: 'done' });

		expect(await files(repo)).toEqual(['.gitignore', 'analysis.R', 'data/raw.csv']);
		expect((await readChanges(repo.ports)).files).toEqual([]);
		expect(await must(repo, ['-C', path.join(repo.root, 'tools', 'lib'), 'rev-parse', 'HEAD'])).toBe(nestedHead);
		expect(await repo.read('tools/lib/x.txt')).toBe('x\n');
	});

	test('a folder inside a parent repository with no checkpoints is refused, and nothing changes', async () => {
		const parent = await tempRepo();
		repos.push(parent);
		await parent.write('other.txt', 'not mine\n');
		await parent.write('opened/analysis.R', 'x <- 1\n');
		const opened = path.join(parent.root, 'opened');
		const ports = { ...parent.ports, projectRoot: opened, openedFolder: opened };
		const listing = async () => [await fsp.readdir(parent.root), await fsp.readdir(opened), await fsp.readdir(path.join(parent.root, '.git'))];
		const config = await fsp.readFile(path.join(parent.root, '.git', 'config'), 'utf8');
		const before = await listing();

		expect(await startTracking(ports, identity, 'proposed\n')).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'inside-another-project' });

		expect(await listing()).toEqual(before);
		expect(await fsp.readFile(path.join(parent.root, '.git', 'config'), 'utf8')).toBe(config);
		expect((await parent.git(['rev-parse', '--verify', '-q', 'HEAD'])).exitCode).not.toBe(0);
	});

	test.skipIf(process.platform === 'win32')('a project opened through a symbolic link can start', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('analysis.R', 'x <- 1\n');
		const link = path.join(path.dirname(repo.root), 'link');
		await fsp.symlink(repo.root, link);

		expect(await startTracking({ ...repo.ports, openedFolder: link }, identity)).toMatchObject({ kind: 'done' });
	});

	test('a project that has a checkpoint is refused', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'a\n');
		await repo.commit('A');

		expect(await startTracking(repo.ports, identity)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'already-tracking' });
	});
});
