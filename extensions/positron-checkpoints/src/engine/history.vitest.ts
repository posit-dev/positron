/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import { createCheckpoints } from './checkpoints';
import { getCheckpointFiles, getDiff, getHistory, getPendingFiles, readBlob } from './history';
import { must } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';

describe('history', { timeout: 30_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		const a = await repo.commit('A');
		return { repo, a };
	};

	/** Commits everything as another person. */
	const commitAs = async (repo: TempRepo, message: string, name: string, email: string) => {
		await must(repo, ['add', '-A']);
		const date = repo.ports.now().toISOString();
		await must(repo, ['commit', '-m', message], {
			env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
		});
		return must(repo, ['rev-parse', 'HEAD']);
	};

	const blob = async (repo: TempRepo, spec: string) => ({ kind: 'blob', oid: await must(repo, ['rev-parse', spec]) });

	test('history is newest first with title, body, author, and time', async () => {
		const { repo, a } = await create();
		repo.clock.advance(3_600_000);
		await repo.write('a.txt', 'two\n');
		const b = await repo.commit('Second title\n\nThe body,\nover two lines.\n');

		expect(await getHistory(repo.ports, 0, 10)).toEqual([
			{ id: b, title: 'Second title', body: 'The body,\nover two lines.', authorName: 'Test User', authorIsMe: true, time: '2026-01-01T01:00:00.000Z', shared: false, partialFiles: [] },
			{ id: a, title: 'A', body: '', authorName: 'Test User', authorIsMe: true, time: '2026-01-01T00:00:00.000Z', shared: false, partialFiles: [] },
		]);
	});

	test('a repository with no checkpoints has an empty history', async () => {
		const repo = await tempRepo();
		repos.push(repo);

		expect(await getHistory(repo.ports, 0, 10)).toEqual([]);
	});

	test('shared is false for checkpoints ahead of the upstream', async () => {
		const { repo, a } = await create();
		await repo.clone();
		await repo.write('a.txt', 'two\n');
		const b = await repo.commit('B');

		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.id, checkpoint.shared])).toEqual([[b, false], [a, true]]);
	});

	test('authorIsMe distinguishes a colleague', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await commitAs(repo, 'From Maya', 'Maya', 'maya@example.com');

		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => [checkpoint.authorName, checkpoint.authorIsMe])).toEqual([['Maya', false], ['Test User', true]]);
	});

	test('skip and limit page the list', async () => {
		const { repo } = await create();
		for (const title of ['B', 'C', 'D']) {
			await repo.write('a.txt', `${title}\n`);
			await repo.commit(title);
		}

		const page = async (skip: number, limit: number) => (await getHistory(repo.ports, skip, limit)).map(checkpoint => checkpoint.title);
		expect([await page(0, 2), await page(2, 2), await page(4, 2), await page(1, 0)]).toEqual([['D', 'C'], ['B', 'A'], [], []]);
	});

	test('history follows the first parent only', async () => {
		const { repo, a } = await create();
		await must(repo, ['checkout', '-q', '-b', 'side']);
		await repo.write('side.txt', 'side\n');
		await repo.commit('Side');
		await must(repo, ['checkout', '-q', 'main']);
		await must(repo, ['merge', '-q', '--no-ff', '-m', 'Merge side', 'side']);

		expect((await getHistory(repo.ports, 0, 10)).map(checkpoint => checkpoint.title)).toEqual(['Merge side', 'A']);
		expect((await getHistory(repo.ports, 1, 10))[0].id).toBe(a);
	});

	test('partialFiles come from the metadata file', async () => {
		const { repo } = await create();
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
		await repo.write('long.txt', lines.join('\n') + '\n');
		await repo.commit('B');
		await repo.write('long.txt', ['first', ...lines.slice(1, 11), 'last'].join('\n') + '\n');
		const changes = await readChanges(repo.ports);
		const result = await createCheckpoints(repo.ports, changes.basis, [{ title: 'Top line', body: '', hunkIds: [changes.files[0].hunks[0].id], wholeFiles: [] }]);
		expect(result.kind).toBe('done');

		expect((await getHistory(repo.ports, 0, 2)).map(checkpoint => checkpoint.partialFiles)).toEqual([['long.txt'], []]);
	});

	test('getDiff change: left is the HEAD blob, right is the file', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');

		expect(await getDiff(repo.ports, { kind: 'change', path: 'a.txt' })).toEqual({ left: await blob(repo, 'HEAD:a.txt'), right: { kind: 'file', path: 'a.txt' } });
	});

	test('getDiff for an added file has an empty left side', async () => {
		const { repo } = await create();
		await repo.write('new file.txt', 'new\n');
		await repo.write('b.txt', 'bee\n');
		await repo.commit('B');
		await fsp.rm(path.join(repo.root, 'b.txt'));

		expect(await getDiff(repo.ports, { kind: 'change', path: 'c.txt' })).toEqual({ left: { kind: 'empty' }, right: { kind: 'empty' } });
		expect(await getDiff(repo.ports, { kind: 'change', path: 'b.txt' })).toEqual({ left: await blob(repo, 'HEAD:b.txt'), right: { kind: 'empty' } });
		expect(await getDiff(repo.ports, { kind: 'checkpoint', id: await must(repo, ['rev-parse', 'HEAD']), path: 'new file.txt' }))
			.toEqual({ left: { kind: 'empty' }, right: await blob(repo, 'HEAD:new file.txt') });
	});

	test('getDiff change for an untracked new file has an empty left side', async () => {
		const { repo } = await create();
		await repo.write('new.txt', 'new\n');

		expect(await getDiff(repo.ports, { kind: 'change', path: 'new.txt' })).toEqual({ left: { kind: 'empty' }, right: { kind: 'file', path: 'new.txt' } });
	});

	test('getDiff change for a renamed file takes the left side from the old path', async () => {
		const { repo } = await create();
		await fsp.rename(path.join(repo.root, 'a.txt'), path.join(repo.root, 'renamed.txt'));
		const [file] = (await readChanges(repo.ports)).files;
		expect(file).toMatchObject({ path: 'renamed.txt', oldPath: 'a.txt', status: 'renamed' });

		expect(await getDiff(repo.ports, { kind: 'change', path: file.path, oldPath: file.oldPath }))
			.toEqual({ left: await blob(repo, 'HEAD:a.txt'), right: { kind: 'file', path: 'renamed.txt' } });
	});

	test('getDiff trees with a missing or non-tree id has empty sides', async () => {
		const { repo, a } = await create();
		const tree = await must(repo, ['rev-parse', `${a}^{tree}`]);
		const blobId = await must(repo, ['rev-parse', `${a}:a.txt`]);
		const missing = 'f'.repeat(40);

		expect(await getDiff(repo.ports, { kind: 'trees', left: missing, right: tree, path: 'a.txt' })).toEqual({ left: { kind: 'empty' }, right: await blob(repo, `${a}:a.txt`) });
		expect(await getDiff(repo.ports, { kind: 'trees', left: tree, right: blobId, path: 'a.txt' })).toEqual({ left: await blob(repo, `${a}:a.txt`), right: { kind: 'empty' } });
	});

	test('getDiff checkpoint follows a rename to the parent blob', async () => {
		const { repo } = await create();
		await must(repo, ['mv', 'a.txt', 'renamed.txt']);
		const b = await repo.commit('Rename');

		expect(await getDiff(repo.ports, { kind: 'checkpoint', id: b, path: 'renamed.txt' })).toEqual({ left: await blob(repo, 'HEAD^:a.txt'), right: await blob(repo, 'HEAD:renamed.txt') });
		expect(await getCheckpointFiles(repo.ports, b)).toEqual([
			{ path: 'renamed.txt', oldPath: 'a.txt', status: 'renamed', binary: false, sizeBytes: 4, tooLarge: false, hunks: [] },
		]);
	});

	test('getDiff incoming compares the merge base with the upstream', async () => {
		const { repo } = await create();
		const colleague = await repo.clone();
		await colleague.write('a.txt', 'theirs\n');
		await colleague.commit('Theirs');
		await repo.pushFrom(colleague);
		await must(repo, ['fetch', '-q']);

		expect(await getDiff(repo.ports, { kind: 'incoming', path: 'a.txt' })).toEqual({ left: await blob(repo, 'HEAD:a.txt'), right: await blob(repo, 'origin/main:a.txt') });
	});

	test('getCheckpointFiles lists the first checkpoint against the empty tree', async () => {
		const { repo, a } = await create();
		await fsp.writeFile(path.join(repo.root, 'data.bin'), Buffer.from([0, 1, 2]));
		await repo.write('a.txt', 'two\n');
		const b = await repo.commit('B');

		expect(await getCheckpointFiles(repo.ports, a)).toEqual([{ path: 'a.txt', status: 'added', binary: false, sizeBytes: 4, tooLarge: false, hunks: [] }]);
		expect(await getCheckpointFiles(repo.ports, b)).toEqual([
			{ path: 'a.txt', status: 'modified', binary: false, sizeBytes: 4, tooLarge: false, hunks: [] },
			{ path: 'data.bin', status: 'added', binary: true, sizeBytes: 3, tooLarge: false, hunks: [] },
		]);
	});

	test.skipIf(process.platform === 'win32')('getPendingFiles and getDiff pending compare the approved and the changed tree', async () => {
		const { repo } = await create();
		await repo.write('a.txt', 'two\n');
		await repo.write('other.txt', 'not selected\n');
		const hook = path.join(repo.root, '.git', 'hooks', 'pre-commit');
		await fsp.mkdir(path.dirname(hook), { recursive: true });
		await fsp.writeFile(hook, '#!/bin/sh\ngit add other.txt\n', { mode: 0o755 });
		const changes = await readChanges(repo.ports);
		const result = await createCheckpoints(repo.ports, changes.basis, [{ title: 'Edit a', body: '', hunkIds: [], wholeFiles: ['a.txt'] }]);
		if (result.kind !== 'check-changed-checkpoint') {
			throw new Error(JSON.stringify(result));
		}

		expect(await getPendingFiles(repo.ports, result.token)).toEqual([{ path: 'other.txt', status: 'added', binary: false, sizeBytes: 13, tooLarge: false, hunks: [] }]);
		const candidate = `refs/positron-checkpoints/pending/${result.token}`;
		expect(await getDiff(repo.ports, { kind: 'pending', token: result.token, path: 'other.txt' })).toEqual({ left: { kind: 'empty' }, right: await blob(repo, `${candidate}:other.txt`) });
		expect(await getPendingFiles(repo.ports, 'unknown')).toEqual([]);
	});

	test('readBlob returns binary content unchanged', async () => {
		const { repo } = await create();
		const bytes = Buffer.from(Array.from({ length: 512 }, (_, index) => index % 256));
		await fsp.writeFile(path.join(repo.root, 'data.bin'), bytes);
		await repo.commit('B');

		const content = await readBlob(repo.ports, await must(repo, ['rev-parse', 'HEAD:data.bin']));

		expect(Buffer.from(content).equals(bytes)).toBe(true);
		await expect(readBlob(repo.ports, '--help')).rejects.toThrow();
	});
});
