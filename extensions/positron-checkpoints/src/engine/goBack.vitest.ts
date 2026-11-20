/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { readChanges } from './changes';
import { getHistory } from './history';
import { goBackTo } from './goBack';
import { listKept } from './collisions';
import { undo, undoHead } from './operationLog';
import { must } from './test/operationFixtures';
import { tempRepo, TempRepo } from './test/tempRepo';
import { OperationResult } from './types';

describe('goBack', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	/**
	 * Checkpoint A has a.txt "one" and b.txt "bee". Checkpoint B changes a.txt to "two" and adds
	 * c.txt. The working files then have an unrecorded edit of b.txt.
	 */
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('b.txt', 'bee\n');
		const a = await repo.commit('A');
		await repo.write('a.txt', 'two\n');
		await repo.write('c.txt', 'sea\n');
		const b = await repo.commit('B');
		await repo.write('b.txt', 'bee, edited\n');
		return { repo, a, b };
	};

	const doneId = (result: OperationResult): string => {
		if (result.kind !== 'done') {
			throw new Error(`the operation did not finish: ${JSON.stringify(result)}`);
		}
		return result.operationId;
	};

	const exists = async (repo: TempRepo, file: string) => (await fsp.lstat(path.join(repo.root, file)).catch(() => undefined)) !== undefined;

	test('files match the chosen checkpoint and history is unchanged', async () => {
		const { repo, a, b } = await create();
		const history = await getHistory(repo.ports, 0, 10);
		const index = await must(repo, ['write-tree']);

		doneId(await goBackTo(repo.ports, a, []));

		expect([await repo.read('a.txt'), await repo.read('b.txt')]).toEqual(['one\n', 'bee\n']);
		expect(await getHistory(repo.ports, 0, 10)).toEqual(history);
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(b);
		expect(await must(repo, ['write-tree'])).toBe(index);
		expect((await undoHead(repo.ports))?.kind).toBe('go-back');
	});

	test('the difference appears in readChanges', async () => {
		const { repo, a } = await create();

		doneId(await goBackTo(repo.ports, a, []));

		expect((await readChanges(repo.ports)).files.map(file => [file.path, file.status])).toEqual([['a.txt', 'modified'], ['c.txt', 'deleted']]);
	});

	test('untracked files are left in place', async () => {
		const { repo, a } = await create();
		await repo.write('notes/u.txt', 'untracked\n');
		await repo.write('u.txt', 'untracked too\n');

		doneId(await goBackTo(repo.ports, a, []));

		expect([await repo.read('notes/u.txt'), await repo.read('u.txt')]).toEqual(['untracked\n', 'untracked too\n']);
	});

	test('a file added after that checkpoint and tracked is removed', async () => {
		const { repo, a } = await create();

		doneId(await goBackTo(repo.ports, a, []));

		expect(await exists(repo, 'c.txt')).toBe(false);
	});

	test('undo returns the prior files', async () => {
		const { repo, a } = await create();
		await repo.write('u.txt', 'untracked\n');

		const id = doneId(await goBackTo(repo.ports, a, []));
		doneId(await undo(repo.ports, id, []));

		expect([await repo.read('a.txt'), await repo.read('b.txt'), await repo.read('c.txt'), await repo.read('u.txt')])
			.toEqual(['two\n', 'bee, edited\n', 'sea\n', 'untracked\n']);
		expect((await readChanges(repo.ports)).files.map(file => file.path)).toEqual(['b.txt', 'u.txt']);
	});

	test('an untracked file at a path the checkpoint has is replaced, and undo returns it', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('d.txt', 'dee at A\n');
		const a = await repo.commit('A');
		await must(repo, ['rm', '-q', 'd.txt']);
		await repo.commit('Remove d');
		await repo.write('d.txt', 'my own d\n');

		const id = doneId(await goBackTo(repo.ports, a, []));
		expect(await repo.read('d.txt')).toBe('dee at A\n');

		doneId(await undo(repo.ports, id, []));
		expect(await repo.read('d.txt')).toBe('my own d\n');
	});

	test('a collision with an ignored file is refused without a choice', async () => {
		const repo = await tempRepo();
		repos.push(repo);
		await repo.write('a.txt', 'one\n');
		await repo.write('out.log', 'tracked at A\n');
		const a = await repo.commit('A');
		await must(repo, ['rm', '-q', 'out.log']);
		await repo.write('.gitignore', '*.log\n');
		const b = await repo.commit('Ignore logs');
		await repo.write('a.txt', 'two\n');
		await repo.write('out.log', 'my own log\n');

		const refused = await goBackTo(repo.ports, a, []);

		expect(refused).toEqual({ kind: 'path-collisions', collisions: [{ path: 'out.log', reason: 'ignored', sizeBytes: 11 }] });
		expect([await repo.read('a.txt'), await repo.read('out.log'), await repo.read('.gitignore')]).toEqual(['two\n', 'my own log\n', '*.log\n']);
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(b);
		expect(await undoHead(repo.ports)).toBeUndefined();

		doneId(await goBackTo(repo.ports, a, [{ path: 'out.log', choice: 'use-theirs-keep-copy' }]));
		expect([await repo.read('a.txt'), await repo.read('out.log')]).toEqual(['one\n', 'tracked at A\n']);
		expect((await listKept(repo.ports)).map(file => file.originalPath)).toEqual(['out.log']);
	});

	test('an id that is not a full id of a checkpoint in this history changes nothing', async () => {
		const { repo, a } = await create();
		const elsewhere = await must(repo, ['commit-tree', `${a}^{tree}`, '-m', 'Elsewhere']);

		const notInHistory = { kind: 'unavailable', reason: 'nothing-to-do', detail: 'not-in-history' };
		expect(await goBackTo(repo.ports, a.slice(0, 10), [])).toEqual(notInHistory);
		expect(await goBackTo(repo.ports, elsewhere, [])).toEqual(notInHistory);
		expect(await goBackTo(repo.ports, 'HEAD', [])).toEqual(notInHistory);
		expect(await repo.read('a.txt')).toBe('two\n');
	});

	test('going back to the files as they are changes nothing', async () => {
		const { repo, b } = await create();
		await repo.write('b.txt', 'bee\n');

		expect(await goBackTo(repo.ports, b, [])).toEqual({ kind: 'unavailable', reason: 'nothing-to-do', detail: 'unchanged' });
		expect(await undoHead(repo.ports)).toBeUndefined();
	});

	test('staged work from another tool is refused', async () => {
		const { repo, a } = await create();
		await must(repo, ['add', 'b.txt']);

		expect(await goBackTo(repo.ports, a, [])).toEqual({ kind: 'unavailable', reason: 'unusual-state', detail: 'staged-work' });
		expect(await repo.read('a.txt')).toBe('two\n');
	});
});
