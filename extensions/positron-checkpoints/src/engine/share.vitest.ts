/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { createEngine } from './engine';
import { createGitRunner } from './git';
import { engineDirectory } from './journal';
import { EnginePorts } from './ports';
import { connectSharedCopy } from './sync';
import { must } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';

// Each test runs git several times in new repositories, which can exceed the default limit under a loaded test run.
describe('connecting a shared copy', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/** A local-only project with one checkpoint, and the path of a new, empty bare repository beside it. */
	const localProject = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.commit('A');
		const bare = path.join(path.dirname(repo.root), 'shared.git');
		await must(repo, ['init', '--bare', '-b', 'main', bare]);
		return { repo, bare };
	};

	/** The remotes, the branch settings, and the connection record of the project. */
	const remoteState = async (repo: TempRepo) => ({
		remotes: await must(repo, ['remote']),
		branchConfig: (await repo.git(['config', '--get-regexp', '^branch\\.'])).stdout.trim(),
		record: await fsp.stat(`${await engineDirectory(repo.ports)}/connect.json`).catch(() => undefined),
	});

	const unchanged = { remotes: '', branchConfig: '', record: undefined };

	test('a local-only project gets a shared copy and reports ahead 0', async () => {
		const { repo, bare } = await localProject();
		const engine = await createEngine(repo.ports);
		let events = 0;
		engine.onDidChangeState(() => events++);

		const result = await engine.connectSharedCopy(bare);

		expect(result).toEqual({ kind: 'done', operationId: '', hookEditedFiles: [] });
		expect((await engine.getState()).shared).toMatchObject({ exists: true, ahead: 0, behind: 0, name: 'origin/main' });
		expect(events).toBe(1);
		expect(await must(repo, ['rev-parse', 'HEAD'])).toBe((await createGitRunner('git', bare)(['rev-parse', 'main'])).stdout.trim());
		expect(await fsp.stat(`${await engineDirectory(repo.ports)}/connect.json`).catch(() => undefined)).toBeUndefined();
	});

	test('a project that already has a shared copy is refused', async () => {
		const { repo } = await localProject();
		await repo.clone().then(clone => repos.push(clone));
		const before = await remoteState(repo);

		expect(await connectSharedCopy(repo.ports, '/elsewhere.git')).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'already-shared' });

		expect(await remoteState(repo)).toEqual(before);
	});

	test('a failed publish removes the remote again', async () => {
		const { repo } = await localProject();
		const missing = path.join(path.dirname(repo.root), 'missing.git');

		const result = await connectSharedCopy(repo.ports, missing);

		expect(result).toMatchObject({ kind: 'rejected', reason: 'no-shared-copy' });
		expect(await remoteState(repo)).toEqual(unchanged);
	});

	test('a publish that throws removes the remote again', async () => {
		const { repo, bare } = await localProject();
		const ports: EnginePorts = { ...repo.ports, network: { ...repo.ports.network, publish: async () => { throw new Error('the network port failed'); } } };

		await expect(connectSharedCopy(ports, bare)).rejects.toThrow('the network port failed');

		expect(await remoteState(repo)).toEqual(unchanged);
	});

	test('a project with no checkpoint is refused', async () => {
		const repo = await tempRepo();
		repos.push(repo);

		expect(await connectSharedCopy(repo.ports, '/elsewhere.git')).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'no-checkpoints' });

		expect(await remoteState(repo)).toEqual(unchanged);
	});

	test('a remote origin with no upstream is refused and kept', async () => {
		const { repo, bare } = await localProject();
		await must(repo, ['remote', 'add', 'origin', '/their/remote.git']);

		expect(await connectSharedCopy(repo.ports, bare)).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'origin-exists' });

		expect(await must(repo, ['remote', 'get-url', 'origin'])).toBe('/their/remote.git');
		expect((await remoteState(repo)).branchConfig).toBe('');
	});

	test('a plain folder is refused with not-tracking', async () => {
		const repo = await tempRepo({ init: 'none' });
		repos.push(repo);
		const engine = await createEngine(repo.ports);

		expect(await engine.connectSharedCopy('/elsewhere.git')).toEqual({ kind: 'unavailable', reason: 'not-tracking' });
	});

	test('the engine start removes the remote of a connection that stopped before its send ended', async () => {
		const { repo, bare } = await localProject();
		await must(repo, ['remote', 'add', 'origin', bare]);
		const record = `${await engineDirectory(repo.ports)}/connect.json`;
		await fsp.mkdir(path.dirname(record), { recursive: true });
		await fsp.writeFile(record, JSON.stringify({ url: bare }));

		const engine = await createEngine(repo.ports);

		expect(await remoteState(repo)).toEqual(unchanged);
		expect(await engine.connectSharedCopy(bare)).toMatchObject({ kind: 'done' });
	});

	test('the engine start keeps a remote origin whose URL differs from the record', async () => {
		const { repo, bare } = await localProject();
		await must(repo, ['remote', 'add', 'origin', '/their/remote.git']);
		const record = `${await engineDirectory(repo.ports)}/connect.json`;
		await fsp.mkdir(path.dirname(record), { recursive: true });
		await fsp.writeFile(record, JSON.stringify({ url: bare }));

		await createEngine(repo.ports);

		expect(await remoteState(repo)).toEqual({ ...unchanged, remotes: 'origin' });
	});
});
