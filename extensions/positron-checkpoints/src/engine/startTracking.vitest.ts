/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
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

	test('a folder that is already a project is refused', async () => {
		const repo = await tempRepo();
		repos.push(repo);

		expect(await startTracking(repo.ports, identity)).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'already-tracking' });
	});
});
