/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { ChunkError, readChanges, treeForChunk } from './changes';
import { tempRepo, TempRepo } from './test/tempRepo';
import { ChangedFile, ChangeSet, Chunk } from './types';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Numbered lines `line 1` to `line <count>`, each ending in `eol`. */
function numbered(count: number, eol = '\n'): string[] {
	return Array.from({ length: count }, (_, i) => `line ${i + 1}${eol}`);
}

describe('changes', () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};
	const chunkOf = (hunkIds: string[], wholeFiles: string[] = []): Chunk => ({ title: 't', body: '', hunkIds, wholeFiles });
	const fileNamed = (changes: ChangeSet, name: string): ChangedFile => {
		const file = changes.files.find(candidate => candidate.path === name);
		if (file === undefined) {
			throw new Error(`no changed file ${name}`);
		}
		return file;
	};
	/** The bytes of a file in a tree, as a latin1 string. */
	const show = async (repo: TempRepo, tree: string, file: string) =>
		(await repo.git(['cat-file', 'blob', `${tree}:${file}`], { binary: true })).stdout;
	const headTree = async (repo: TempRepo) => (await repo.git(['rev-parse', 'HEAD^{tree}'])).stdout.trim();

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('lists added, modified, deleted, and renamed files', async () => {
		const repo = await create();
		await repo.write('mod.txt', numbered(10).join(''));
		await repo.write('gone.txt', 'bye\n');
		await repo.write('old.txt', numbered(20).join(''));
		await repo.commit('first');
		await repo.write('mod.txt', numbered(10).join('').replace('line 5\n', 'five\n'));
		await fsp.rm(path.join(repo.root, 'gone.txt'));
		await fsp.rename(path.join(repo.root, 'old.txt'), path.join(repo.root, 'new.txt'));
		await repo.write('added.txt', 'new\n');
		const changes = await readChanges(repo.ports);
		expect(changes.files.map(file => [file.path, file.oldPath, file.status, file.binary, file.hunks.length])).toEqual([
			['added.txt', undefined, 'added', false, 1],
			['gone.txt', undefined, 'deleted', false, 1],
			['mod.txt', undefined, 'modified', false, 1],
			['new.txt', 'old.txt', 'renamed', false, 0],
		]);
		expect(changes.files.map(file => [file.sizeBytes, file.tooLarge])).toEqual([[4, false], [0, false], [69, false], [numbered(20).join('').length, false]]);
		const modified = fileNamed(changes, 'mod.txt');
		expect(modified.hunks[0]).toMatchObject({ addedLines: 1, removedLines: 1 });
		expect(modified.hunks[0].header).toMatch(/^@@ -2,7 \+2,7 @@/);
		expect(modified.hunks[0].patch).toContain('-line 5\n+five\n');
	});

	test('with no checkpoints every file is added', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const changes = await readChanges(repo.ports);
		expect(changes.files.map(file => [file.path, file.status])).toEqual([['a.txt', 'added']]);
		const { tree } = await treeForChunk(repo.ports, EMPTY_TREE, changes, chunkOf([], ['a.txt']));
		expect(await show(repo, tree, 'a.txt')).toBe('one\n');
	});

	test('hunk ids stay the same when an earlier hunk in the file changes', async () => {
		const repo = await create();
		await repo.write('a.txt', numbered(40).join(''));
		await repo.commit('first');
		const edit = (first: string) => numbered(40).join('').replace('line 3\n', first).replace('line 35\n', 'late\n');
		await repo.write('a.txt', edit('early\n'));
		const before = fileNamed(await readChanges(repo.ports), 'a.txt').hunks;
		await repo.write('a.txt', edit('early\nextra one\nextra two\n'));
		const after = fileNamed(await readChanges(repo.ports), 'a.txt').hunks;
		expect(before).toHaveLength(2);
		expect(after).toHaveLength(2);
		expect(after[0].id).not.toBe(before[0].id);
		expect(after[1].id).toBe(before[1].id);
		expect(after[1].header).not.toBe(before[1].header);
		expect(before[0].id).toMatch(/^[0-9a-f]{16}$/);
	});

	test('two identical hunks in one file get different ids', async () => {
		const repo = await create();
		const block = ['a\n', 'b\n', 'c\n', 'old\n', 'd\n', 'e\n', 'f\n'];
		const content = (middle: string) => [...block, ...numbered(12).map(line => `filler ${line}`), ...block].join('').replace(/old\n/g, middle);
		await repo.write('a.txt', content('old\n'));
		await repo.commit('first');
		await repo.write('a.txt', content('new\n'));
		const hunks = fileNamed(await readChanges(repo.ports), 'a.txt').hunks;
		expect(hunks).toHaveLength(2);
		expect(hunks[0].patch.split('\n').slice(1)).toEqual(hunks[1].patch.split('\n').slice(1));
		expect(hunks[0].id).not.toBe(hunks[1].id);
		const { tree } = await treeForChunk(repo.ports, await headTree(repo), await readChanges(repo.ports), chunkOf([hunks[1].id]));
		expect(await show(repo, tree, 'a.txt')).toBe(content('old\n').replace(/old\n(?![\s\S]*old\n)/, 'new\n'));
	});

	test('basis changes when a file is edited', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.commit('first');
		const same = (await readChanges(repo.ports)).basis;
		expect((await readChanges(repo.ports)).basis).toBe(same);
		await repo.write('a.txt', 'two\n');
		const edited = (await readChanges(repo.ports)).basis;
		expect(edited).not.toBe(same);
		await repo.git(['add', 'a.txt']);
		expect((await readChanges(repo.ports)).basis).not.toBe(edited);
	});

	describe('treeForChunk', () => {
		const twoHunks = async () => {
			const repo = await create();
			await repo.write('a.txt', numbered(40).join(''));
			await repo.commit('first');
			await repo.write('a.txt', numbered(40).join('').replace('line 3\n', 'three\nand a half\n').replace('line 35\n', 'late\n'));
			const changes = await readChanges(repo.ports);
			return { repo, changes, hunks: fileNamed(changes, 'a.txt').hunks, base: await headTree(repo) };
		};

		test('with one of two hunks contains only that hunk', async () => {
			const { repo, changes, hunks, base } = await twoHunks();
			const second = await treeForChunk(repo.ports, base, changes, chunkOf([hunks[1].id]));
			expect(await show(repo, second.tree, 'a.txt')).toBe(numbered(40).join('').replace('line 35\n', 'late\n'));
			const first = await treeForChunk(repo.ports, base, changes, chunkOf([hunks[0].id]));
			expect(await show(repo, first.tree, 'a.txt')).toBe(numbered(40).join('').replace('line 3\n', 'three\nand a half\n'));
			const both = await treeForChunk(repo.ports, base, changes, chunkOf([hunks[1].id, hunks[0].id]));
			expect(await show(repo, both.tree, 'a.txt')).toBe(await repo.read('a.txt'));
		});

		test('leaves the working file and real index unchanged', async () => {
			const { repo, changes, hunks, base } = await twoHunks();
			await repo.write('new.txt', 'n\n');
			const changed = await readChanges(repo.ports);
			const working = await fsp.readFile(path.join(repo.root, 'a.txt'));
			const index = await fsp.readFile(path.join(repo.root, '.git', 'index'));
			await treeForChunk(repo.ports, base, changed, chunkOf([hunks[0].id], ['new.txt']));
			expect(await fsp.readFile(path.join(repo.root, 'a.txt'))).toEqual(working);
			expect(await fsp.readFile(path.join(repo.root, '.git', 'index'))).toEqual(index);
			expect(await fsp.readdir(path.join(repo.root, '.git', 'positron-checkpoints', 'tmp'))).toEqual(['.keep']);
			expect(changes.files.length).toBe(1);
		});

		test('reports partialFiles', async () => {
			const { repo, changes, hunks, base } = await twoHunks();
			expect((await treeForChunk(repo.ports, base, changes, chunkOf([hunks[0].id]))).partialFiles).toEqual(['a.txt']);
			expect((await treeForChunk(repo.ports, base, changes, chunkOf([hunks[0].id, hunks[1].id]))).partialFiles).toEqual([]);
			expect((await treeForChunk(repo.ports, base, changes, chunkOf([], ['a.txt']))).partialFiles).toEqual([]);
			expect((await treeForChunk(repo.ports, base, changes, chunkOf([]))).partialFiles).toEqual([]);
		});

		test('with a whole new file and a whole deleted file', async () => {
			const repo = await create();
			await repo.write('keep.txt', 'k\n');
			await repo.write('gone.txt', 'bye\n');
			await repo.write('old.txt', numbered(20).join(''));
			await repo.commit('first');
			await fsp.rm(path.join(repo.root, 'gone.txt'));
			await fsp.rename(path.join(repo.root, 'old.txt'), path.join(repo.root, 'new.txt'));
			await repo.write('added.txt', 'new\n');
			await repo.write('keep.txt', 'changed\n');
			const changes = await readChanges(repo.ports);
			const base = await headTree(repo);
			const { tree } = await treeForChunk(repo.ports, base, changes, chunkOf([], ['added.txt', 'gone.txt', 'new.txt']));
			const names = (await repo.git(['ls-tree', '-r', '--name-only', tree])).stdout.trim().split('\n');
			expect(names).toEqual(['added.txt', 'keep.txt', 'new.txt']);
			expect(await show(repo, tree, 'keep.txt')).toBe('k\n');
			expect(await show(repo, tree, 'new.txt')).toBe(numbered(20).join(''));
			// The single hunk of an added file selects the whole file.
			const byHunk = await treeForChunk(repo.ports, base, changes, chunkOf([fileNamed(changes, 'added.txt').hunks[0].id]));
			expect((await repo.git(['ls-tree', '-r', '--name-only', byHunk.tree])).stdout.trim().split('\n')).toEqual(['added.txt', 'gone.txt', 'keep.txt', 'old.txt']);
		});

		test('a binary file has no hunks and can be included whole', async () => {
			const repo = await create();
			await repo.write('a.txt', 'one\n');
			await repo.commit('first');
			const bytes = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13, 10]);
			await fsp.writeFile(path.join(repo.root, 'data.bin'), bytes);
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'data.bin')).toMatchObject({ binary: true, hunks: [], status: 'added', sizeBytes: 9 });
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['data.bin']));
			expect(Buffer.from(await show(repo, tree, 'data.bin'), 'latin1')).toEqual(bytes);
		});

		test('unknown or repeated hunk id throws ChunkError', async () => {
			const { repo, changes, hunks, base } = await twoHunks();
			await expect(treeForChunk(repo.ports, base, changes, chunkOf(['0123456789abcdef']))).rejects.toBeInstanceOf(ChunkError);
			await expect(treeForChunk(repo.ports, base, changes, chunkOf([hunks[0].id, hunks[0].id]))).rejects.toBeInstanceOf(ChunkError);
			await expect(treeForChunk(repo.ports, base, changes, chunkOf([], ['nothing.txt']))).rejects.toBeInstanceOf(ChunkError);
		});
	});

	// Review focus 1
	describe.skipIf(process.platform === 'win32')('unusual paths', () => {
		const names = ['with space.txt', 'n\u00e4me \u65e5\u672c.txt', 'line\nbreak.txt', 'dir with space/\u00fc"q".txt'];

		test('paths with spaces, non-ASCII characters, and a newline are listed exactly', async () => {
			const repo = await create();
			for (const name of names) {
				await repo.write(name, 'one\n');
			}
			const changes = await readChanges(repo.ports);
			expect(changes.files.map(file => file.path).sort()).toEqual([...names].sort());
			expect(changes.files.every(file => file.status === 'added' && file.sizeBytes === 4)).toBe(true);
		});

		test('a partial chunk applies to such paths', async () => {
			const repo = await create();
			for (const name of names) {
				await repo.write(name, numbered(40).join(''));
			}
			await repo.commit('first');
			const edited = numbered(40).join('').replace('line 3\n', 'three\n').replace('line 35\n', 'late\n');
			for (const name of names) {
				await repo.write(name, edited);
			}
			const changes = await readChanges(repo.ports);
			const ids = changes.files.map(file => file.hunks[0].id);
			const { tree, partialFiles } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf(ids));
			expect(partialFiles.sort()).toEqual([...names].sort());
			for (const name of names) {
				expect(await show(repo, tree, name)).toBe(numbered(40).join('').replace('line 3\n', 'three\n'));
			}
		});

		test('a renamed file takes its content hunks under the new path', async () => {
			const repo = await create();
			await repo.write('old name.txt', numbered(40).join(''));
			await repo.commit('first');
			await fsp.rename(path.join(repo.root, 'old name.txt'), path.join(repo.root, 'n\u00e4w name.txt'));
			await repo.write('n\u00e4w name.txt', numbered(40).join('').replace('line 3\n', 'three\n').replace('line 35\n', 'late\n'));
			const changes = await readChanges(repo.ports);
			const file = fileNamed(changes, 'n\u00e4w name.txt');
			expect(file).toMatchObject({ status: 'renamed', oldPath: 'old name.txt' });
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([file.hunks[1].id]));
			expect(await show(repo, tree, 'n\u00e4w name.txt')).toBe(numbered(40).join('').replace('line 35\n', 'late\n'));
			expect((await repo.git(['cat-file', '-e', `${tree}:old name.txt`])).exitCode).not.toBe(0);
		});
	});

	// Review focus 2
	describe('line endings', () => {
		test('a file with CRLF line endings: partial chunk has exactly the selected lines', async () => {
			const repo = await create();
			const original = numbered(40, '\r\n').join('');
			await repo.write('a.txt', original);
			await repo.commit('first');
			await repo.write('a.txt', original.replace('line 3\r\n', 'three\r\n').replace('line 35\r\n', 'late\r\n'));
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'a.txt').hunks;
			expect(hunks).toHaveLength(2);
			expect(hunks[0].patch).toContain('-line 3\r\n+three\r\n');
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id]));
			expect(await show(repo, tree, 'a.txt')).toBe(original.replace('line 35\r\n', 'late\r\n'));
		});

		test('a file with mixed line endings keeps each line as it was', async () => {
			const repo = await create();
			const original = numbered(40).map((line, i) => (i % 2 === 0 ? line : line.replace('\n', '\r\n'))).join('');
			await repo.write('a.txt', original);
			await repo.commit('first');
			await repo.write('a.txt', original.replace('line 4\r\n', 'four\r\n').replace('line 35\n', 'late\n'));
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'a.txt').hunks;
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id]));
			expect(await show(repo, tree, 'a.txt')).toBe(original.replace('line 35\n', 'late\n'));
		});

		test('a file with no final newline: last-line hunk applies', async () => {
			const repo = await create();
			const original = numbered(40).join('').replace(/\n$/, '');
			await repo.write('a.txt', original);
			await repo.commit('first');
			await repo.write('a.txt', original.replace('line 2\n', 'two\n').replace('line 40', 'last'));
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'a.txt').hunks;
			expect(hunks).toHaveLength(2);
			expect(hunks[1].patch).toContain('\\ No newline at end of file\n');
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id]));
			expect(await show(repo, tree, 'a.txt')).toBe(original.replace('line 40', 'last'));
			const first = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[0].id]));
			expect(await show(repo, first.tree, 'a.txt')).toBe(original.replace('line 2\n', 'two\n'));
		});

		test('a file that gains its final newline', async () => {
			const repo = await create();
			const original = numbered(40).join('').replace(/\n$/, '');
			await repo.write('a.txt', original);
			await repo.commit('first');
			await repo.write('a.txt', original.replace('line 2\n', 'two\n') + '\n');
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'a.txt').hunks;
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id]));
			expect(await show(repo, tree, 'a.txt')).toBe(original + '\n');
		});

		test('core.autocrlf=true: working file bytes are unchanged after treeForChunk', async () => {
			const repo = await create();
			await repo.git(['config', 'core.autocrlf', 'true']);
			await repo.write('a.txt', numbered(40, '\r\n').join(''));
			await repo.commit('first');
			const edited = numbered(40, '\r\n').join('').replace('line 3\r\n', 'three\r\n').replace('line 35\r\n', 'late\r\n');
			await repo.write('a.txt', edited);
			await repo.write('b.txt', 'new\r\nfile\r\n');
			const working = await fsp.readFile(path.join(repo.root, 'a.txt'));
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'a.txt').hunks;
			expect(hunks).toHaveLength(2);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id], ['b.txt']));
			expect(await fsp.readFile(path.join(repo.root, 'a.txt'))).toEqual(working);
			expect(working.toString('latin1')).toBe(edited);
			// Git may store the lines with or without the carriage returns.
			const stored = (await show(repo, tree, 'a.txt')).replace(/\r\n/g, '\n');
			expect(stored).toBe(numbered(40).join('').replace('line 35\n', 'late\n'));
			expect((await show(repo, tree, 'b.txt')).replace(/\r\n/g, '\n')).toBe('new\nfile\n');
		});
	});
});
