/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getDiff } from './history';
import { readRecords } from './journal';
import { basisOf, checkShared, previewIncoming, replay } from './sync';
import { must } from './test/operationFixtures';
import { LINES, mayaShares, parts, sharedProject, text, withLine } from './test/syncFixtures';
import { TempRepo } from './test/tempRepo';
import { ContentRef } from './types';

// Each test runs several repositories and merges, which exceed the default limit under a loaded test run.
describe('sync preview', { timeout: 60_000 }, () => {
	const repos: TempRepo[] = [];

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	const create = (files: Record<string, string> = {}) => sharedProject(repos, files);
	const show = (repo: TempRepo, spec: string) => must(repo, ['show', spec]);

	test('checkShared changes no file and no local branch', async () => {
		const { repo, maya } = await create();
		await repo.write('a.txt', 'my unrecorded edit\n');
		const before = await parts(repo);
		await maya.write('b.txt', 'theirs\n');
		const shared = await maya.commit('Their change');
		await repo.pushFrom(maya);

		expect(await checkShared(repo.ports)).toEqual({ kind: 'done', operationId: '', hookEditedFiles: [] });

		expect(await parts(repo)).toEqual(before);
		expect(await must(repo, ['rev-parse', 'refs/remotes/origin/main'])).toBe(shared);
	});

	test('incoming changes to other files: clean, no overlaps, touchesLocalWork false', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' }, 'Edit b');
		await repo.write('a.txt', withLine(0, 'mine'));

		const preview = await previewIncoming(repo.ports);

		expect(preview).toMatchObject({ changedPaths: ['b.txt'], touchesLocalWork: false, overlaps: [], collisions: [] });
		expect(preview.incoming).toEqual([expect.objectContaining({ title: 'Edit b', authorName: 'Maya', authorIsMe: false, shared: true })]);
		expect((await replay(repo.ports, [])).clean).toBe(true);
	});

	test('incoming changes to a file I edited in other lines: clean, touchesLocalWork true', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'a.txt': withLine(0, 'theirs') });
		await repo.write('a.txt', withLine(9, 'mine'));

		const preview = await previewIncoming(repo.ports);
		const result = await replay(repo.ports, []);

		expect(preview).toMatchObject({ changedPaths: ['a.txt'], touchesLocalWork: true, overlaps: [] });
		expect(result.clean).toBe(true);
		expect(await show(repo, `${result.after!.worktreeTree}:a.txt`)).toBe(text(['theirs', ...LINES.slice(1, 9), 'mine']).trimEnd());
	});

	test('local unshared checkpoints are replayed on the upstream, history stays linear', async () => {
		const { repo, maya } = await create();
		await repo.write('c.txt', 'first\n');
		repo.clock.advance(60_000);
		const first = await repo.commit('Mine 1');
		await repo.write('c.txt', 'second\n');
		repo.clock.advance(60_000);
		const second = await repo.commit('Mine 2');
		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' });
		const upstream = await must(repo, ['rev-parse', 'refs/remotes/origin/main']);

		const result = await replay(repo.ports, []);

		expect(result.clean).toBe(true);
		expect(result.newCommits).toHaveLength(2);
		const parents = await Promise.all(result.newCommits.map(commit => must(repo, ['rev-list', '--parents', '-n', '1', commit])));
		expect(parents.map(line => line.split(' ').slice(1))).toEqual([[upstream], [result.newCommits[0]]]);
		const describe = (commit: string) => must(repo, ['log', '-1', '--format=%an|%ae|%aI|%B', commit]);
		expect(await Promise.all(result.newCommits.map(describe))).toEqual(await Promise.all([first, second].map(describe)));
		expect(result.after!.branchCommit).toBe(result.newCommits[1]);
		expect(await show(repo, `${result.after!.indexTree}:b.txt`)).toBe('theirs');
		expect(await must(repo, ['rev-parse', 'refs/heads/main'])).toBe(second);
	});

	test('unrecorded edits are in after.worktreeTree and not in after.indexTree', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' });
		await repo.write('a.txt', withLine(4, 'mine'));
		await repo.write('new.txt', 'untracked\n');

		const result = await replay(repo.ports, []);

		const { worktreeTree: work, indexTree: index } = result.after!;
		expect([await show(repo, `${work}:a.txt`), await show(repo, `${work}:new.txt`), await show(repo, `${work}:b.txt`)])
			.toEqual([withLine(4, 'mine').trimEnd(), 'untracked', 'theirs']);
		expect([await show(repo, `${index}:a.txt`), await show(repo, `${index}:b.txt`)]).toEqual([text(LINES).trimEnd(), 'theirs']);
		expect((await repo.git(['cat-file', '-e', `${index}:new.txt`])).exitCode).not.toBe(0);
	});

	test('same lines edited: one text overlap with base, mine, theirs', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs') });
		await repo.write('a.txt', withLine(1, 'mine'));

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({
			kind: 'text', path: 'a.txt', otherPaths: [], base: text(LINES), mine: withLine(1, 'mine'), theirs: withLine(1, 'theirs'), theirAuthor: 'Maya',
		})]);
		expect(preview.overlaps[0].id).toMatch(/^[0-9a-f]{16}$/);
		expect(preview.collisions).toEqual([]);
		expect((await replay(repo.ports, [])).clean).toBe(false);
	});

	test('both added a text file at one path: text overlap with empty base', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'new.txt': 'theirs\n' });
		await repo.write('new.txt', 'mine\n');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'text', path: 'new.txt', base: '', mine: 'mine\n', theirs: 'theirs\n' })]);
	});

	test('both changed a binary file: binary overlap with sizes', async () => {
		const { repo, maya } = await create({ 'data.bin': 'base\0data' });
		await mayaShares(repo, maya, { 'data.bin': 'theirs\0longer data' });
		await repo.write('data.bin', 'mine\0data');
		await repo.commit('Mine');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'binary', path: 'data.bin', mineSizeBytes: 9, theirsSizeBytes: 18 })]);
		expect(preview.overlaps[0].mine).toBeUndefined();
	});

	test('edited by me and deleted by them: edit-delete with deletedBy them', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'b.txt': null });
		await repo.write('b.txt', 'mine\n');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'edit-delete', path: 'b.txt', deletedBy: 'them', mine: 'mine\n' })]);
	});

	test('both renamed one file differently: rename overlap', async () => {
		const { repo, maya } = await create();
		await must(maya, ['mv', 'a.txt', 'theirs.txt']);
		await mayaShares(repo, maya, {});
		await must(repo, ['mv', 'a.txt', 'mine.txt']);
		await repo.commit('Rename mine');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'rename', path: 'a.txt', otherPaths: ['mine.txt', 'theirs.txt'] })]);
	});

	test('file on one side and folder on the other: file-folder overlap', async () => {
		const { repo, maya } = await create({ ff: 'a file\n' });
		await mayaShares(repo, maya, { 'ff': null, 'ff/inside.txt': 'in a folder\n' });
		await repo.write('ff', 'my edit of the file\n');
		await repo.commit('Edit ff');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'file-folder', path: 'ff', otherPaths: [], fileSide: 'mine' })]);
		const id = preview.overlaps[0].id;
		const blob = (ref: ContentRef) => ref.kind === 'blob' ? show(repo, ref.oid) : Promise.resolve(ref.kind);
		const mine = await getDiff(repo.ports, { kind: 'overlap', overlapId: id, side: 'mine' });
		const theirs = await getDiff(repo.ports, { kind: 'overlap', overlapId: id, side: 'theirs' });
		expect([await blob(mine.left), await blob(mine.right), await blob(theirs.right)]).toEqual(['a file', 'my edit of the file', 'empty']);
	});

	test('a submodule conflict is unsupported', async () => {
		const { repo, maya } = await create();
		const gitlink = async (target: TempRepo, commit: string, message: string) => {
			await must(target, ['update-index', '--add', '--cacheinfo', `160000,${commit},sub`]);
			await must(target, ['commit', '-m', message]);
		};
		await gitlink(maya, '1'.repeat(40), 'Add sub');
		await repo.pushFrom(maya);
		await must(repo, ['pull', '--ff-only']);
		await gitlink(maya, '2'.repeat(40), 'Their sub');
		await repo.pushFrom(maya);
		await checkShared(repo.ports);
		await gitlink(repo, '3'.repeat(40), 'My sub');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([expect.objectContaining({ kind: 'unsupported', path: 'sub' })]);
		expect(preview.overlaps[0].detail).toMatch(/submodule/);
	});

	test('preview with overlaps leaves branch, index, and files unchanged', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs') });
		await repo.write('a.txt', withLine(1, 'mine'));
		const before = await parts(repo);

		expect((await previewIncoming(repo.ports)).overlaps).toHaveLength(1);
		await replay(repo.ports, []);

		expect(await parts(repo)).toEqual(before);
		expect(await repo.read('a.txt')).toBe(withLine(1, 'mine'));
		expect(await readRecords(repo.ports)).toEqual([]);
	});

	test('basis changes when an overlapping file is edited, and not when another file is edited', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs') });
		await repo.write('a.txt', withLine(1, 'mine'));
		const first = (await previewIncoming(repo.ports)).basis;

		await repo.write('b.txt', 'another file\n');
		expect((await previewIncoming(repo.ports)).basis).toBe(first);

		await repo.write('a.txt', withLine(1, 'mine, edited again'));
		const second = (await previewIncoming(repo.ports)).basis;
		expect(second).not.toBe(first);
		expect(second.split('.').slice(0, 2)).toEqual(first.split('.').slice(0, 2));
	});

	test('basis changes when the upstream moves and when a local checkpoint is added', async () => {
		const { repo, maya } = await create();
		await mayaShares(repo, maya, { 'a.txt': withLine(1, 'theirs') });
		await repo.write('a.txt', withLine(1, 'mine'));
		const first = (await previewIncoming(repo.ports)).basis;

		await mayaShares(repo, maya, { 'b.txt': 'theirs\n' }, 'More');
		const second = (await previewIncoming(repo.ports)).basis;
		const changed = (left: string, right: string) => left.split('.').slice(0, 3).map((part, index) => part !== right.split('.')[index]);
		expect(changed(first, second)).toEqual([false, true, false]);

		await repo.write('c.txt', 'new\n');
		await must(repo, ['add', 'c.txt']);
		await must(repo, ['commit', '-m', 'Mine']);
		const third = (await previewIncoming(repo.ports)).basis;
		expect(changed(second, third)).toEqual([true, false, false]);
		expect(await basisOf(repo.ports, ['a.txt'], [])).toBe(third);
	});

	test('an incoming file at an ignored local path appears in collisions', async () => {
		const { repo, maya } = await create();
		await maya.write('data.csv', 'theirs\n');
		await must(maya, ['add', '-f', 'data.csv']);
		await must(maya, ['commit', '-m', 'Add data']);
		await repo.pushFrom(maya);
		await checkShared(repo.ports);
		await repo.write('data.csv', 'my own data\n');

		const preview = await previewIncoming(repo.ports);

		expect(preview.overlaps).toEqual([]);
		expect(preview.collisions).toEqual([{ path: 'data.csv', reason: 'ignored', sizeBytes: 12, incomingAuthor: 'Maya' }]);
		expect(preview.basis).toBe(await basisOf(repo.ports, [], ['data.csv']));
	});
});
