/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { ChunkError, MAX_PATCH_FILE_BYTES, MAX_PATCH_TOTAL_BYTES, readChanges, treeForChunk } from './changes';
import { tempRepo, TempRepo } from './test/tempRepo';
import { ChangedFile, ChangeSet, Chunk } from './types';
import { LARGE_FILE_BYTES } from './trees';

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
			const { repo, hunks, base } = await twoHunks();
			await repo.write('new.txt', 'n\n');
			const changed = await readChanges(repo.ports);
			const working = await fsp.readFile(path.join(repo.root, 'a.txt'));
			const index = await fsp.readFile(path.join(repo.root, '.git', 'index'));
			await treeForChunk(repo.ports, base, changed, chunkOf([hunks[0].id], ['new.txt']));
			expect(await fsp.readFile(path.join(repo.root, 'a.txt'))).toEqual(working);
			expect(await fsp.readFile(path.join(repo.root, '.git', 'index'))).toEqual(index);
			expect(await fsp.readdir(path.join(repo.root, '.git', 'positron-checkpoints', 'tmp'))).toEqual(['.keep']);
			expect(changed.files.map(file => file.path)).toEqual(['a.txt', 'new.txt']);
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

	describe('exact bytes', () => {
		test('hunk text is readable and a partial chunk has the exact original bytes', async () => {
			const repo = await create();
			const utf8 = numbered(40).join('').replace('line 3\n', 'caf\u00e9 \u65e5\u672c\n');
			// 0xe9 alone is not valid UTF-8.
			const latin1 = numbered(40).join('').replace('line 3\n', 'caf\u00e9\n');
			await repo.write('u.txt', utf8);
			await fsp.writeFile(path.join(repo.root, 'l.txt'), Buffer.from(latin1, 'latin1'));
			await repo.commit('first');
			await repo.write('u.txt', utf8.replace('line 4\n', 'four\n').replace('line 35\n', 'late\n'));
			await fsp.writeFile(path.join(repo.root, 'l.txt'), Buffer.from(latin1.replace('line 4\n', 'four\n').replace('line 35\n', 'late\n'), 'latin1'));
			const changes = await readChanges(repo.ports);
			const unicode = fileNamed(changes, 'u.txt').hunks;
			expect(unicode).toHaveLength(2);
			expect(unicode[0].patch).toContain('caf\u00e9 \u65e5\u672c');
			const ids = [unicode[0].id, fileNamed(changes, 'l.txt').hunks[0].id];
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf(ids));
			expect(await show(repo, tree, 'u.txt')).toBe(Buffer.from(utf8.replace('line 4\n', 'four\n'), 'utf8').toString('latin1'));
			expect(await show(repo, tree, 'l.txt')).toBe(latin1.replace('line 4\n', 'four\n'));
		});

		test('a change set that no longer matches the files throws changes-moved', async () => {
			const repo = await create();
			await repo.write('a.txt', numbered(40).join(''));
			await repo.commit('first');
			await repo.write('a.txt', numbered(40).join('').replace('line 3\n', 'three\n'));
			const changes = await readChanges(repo.ports);
			await repo.write('a.txt', numbered(40).join('').replace('line 3\n', 'THREE\n'));
			const error = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([changes.files[0].hunks[0].id])).catch(e => e);
			expect(error).toBeInstanceOf(ChunkError);
			expect(error.code).toBe('changes-moved');
		});
	});

	describe('chunks in sequence', () => {
		test('a second chunk that removes a file the first already removed leaves the tree unchanged', async () => {
			const repo = await create();
			await repo.write('a.txt', 'a\n');
			await repo.write('b.txt', 'b\n');
			await repo.commit('first');
			await fsp.rm(path.join(repo.root, 'a.txt'));
			await repo.write('b.txt', 'changed\n');
			const changes = await readChanges(repo.ports);
			const first = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['a.txt']));
			const second = await treeForChunk(repo.ports, first.tree, changes, chunkOf([], ['a.txt']));
			expect(second.tree).toBe(first.tree);
		});

		test('a rename split across two chunks works', async () => {
			const repo = await create();
			await repo.write('old.txt', numbered(20).join(''));
			await repo.commit('first');
			await fsp.rename(path.join(repo.root, 'old.txt'), path.join(repo.root, 'new.txt'));
			const changes = await readChanges(repo.ports);
			expect(changes.files[0]).toMatchObject({ path: 'new.txt', oldPath: 'old.txt', status: 'renamed' });
			const first = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['new.txt']));
			const second = await treeForChunk(repo.ports, first.tree, changes, chunkOf([], ['new.txt']));
			expect((await repo.git(['ls-tree', '-r', '--name-only', second.tree])).stdout.trim()).toBe('new.txt');
		});
	});

	describe('entries that cannot be split', () => {
		test.skipIf(process.platform === 'win32')('a file replaced by a symbolic link, and the reverse, is one whole-only entry', async () => {
			const repo = await create();
			await repo.write('f.txt', 'file\n');
			await repo.write('l', 'target\n');
			await fsp.symlink('l', path.join(repo.root, 'was-link'));
			await repo.commit('first');
			await fsp.rm(path.join(repo.root, 'f.txt'));
			await fsp.symlink('l', path.join(repo.root, 'f.txt'));
			await fsp.rm(path.join(repo.root, 'was-link'));
			await repo.write('was-link', 'now a file\n');
			const changes = await readChanges(repo.ports);
			expect(changes.files.map(file => [file.path, file.status, file.binary, file.hunks.length])).toEqual([
				['f.txt', 'modified', true, 0],
				['was-link', 'modified', true, 0],
			]);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['f.txt', 'was-link']));
			expect((await repo.git(['ls-tree', tree, 'f.txt'])).stdout).toMatch(/^120000 /);
			expect(await show(repo, tree, 'was-link')).toBe('now a file\n');
		});

		test('a submodule entry is whole-only', async () => {
			const repo = await create();
			await repo.write('a.txt', 'a\n');
			await repo.commit('first');
			const inSub = (args: string[]) => repo.git(['-C', 'sub', '-c', 'user.name=n', '-c', 'user.email=n@example.com', ...args]);
			await repo.git(['init', '-q', '-b', 'main', 'sub']);
			await inSub(['commit', '-q', '--allow-empty', '-m', 'one']);
			const sha = (await inSub(['rev-parse', 'HEAD'])).stdout.trim();
			await repo.git(['update-index', '--add', '--cacheinfo', `160000,${sha},sub`]);
			await repo.commit('add submodule entry');
			await inSub(['commit', '-q', '--allow-empty', '-m', 'two']);
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'sub')).toMatchObject({ binary: true, hunks: [], status: 'modified' });
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['sub']));
			const entry = (await repo.git(['ls-tree', tree, 'sub'])).stdout;
			expect(entry).toMatch(/^160000 commit /);
			expect(entry).not.toContain(sha);
		});

		test('a deleted submodule whose commit exists only in the submodule is removed', async () => {
			const repo = await create();
			await repo.write('a.txt', 'a\n');
			await repo.commit('first');
			const inSub = (args: string[]) => repo.git(['-C', 'sub', '-c', 'user.name=n', '-c', 'user.email=n@example.com', ...args]);
			await repo.git(['init', '-q', '-b', 'main', 'sub']);
			await inSub(['commit', '-q', '--allow-empty', '-m', 'one']);
			const sha = (await inSub(['rev-parse', 'HEAD'])).stdout.trim();
			await repo.git(['update-index', '--add', '--cacheinfo', `160000,${sha},sub`]);
			await repo.commit('add submodule entry');
			expect((await repo.git(['cat-file', '-e', sha])).exitCode).not.toBe(0);
			await repo.git(['rm', '-q', '--cached', 'sub']);
			await fsp.rm(path.join(repo.root, 'sub'), { recursive: true, force: true });
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'sub')).toMatchObject({ status: 'deleted', binary: true, hunks: [] });
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['sub']));
			expect((await repo.git(['ls-tree', '-r', '--name-only', tree])).stdout.trim()).toBe('a.txt');
		});
	});

	describe('content of whole files', () => {
		test('a tracked file replaced by a directory: selecting the deletion does not add the directory files', async () => {
			const repo = await create();
			await repo.write('a', 'file\n');
			await repo.write('keep.txt', 'k\n');
			await repo.commit('first');
			await fsp.rm(path.join(repo.root, 'a'));
			await repo.write('a/x.txt', 'inside\n');
			const changes = await readChanges(repo.ports);
			expect(changes.files.map(file => [file.path, file.status])).toEqual([['a', 'deleted'], ['a/x.txt', 'added']]);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['a']));
			expect((await repo.git(['ls-tree', '-r', '--name-only', tree])).stdout.trim()).toBe('keep.txt');
		});

		test('a tracked file replaced by a directory: selecting the deletion and one child leaves out the other children', async () => {
			const repo = await create();
			await repo.write('a', 'file\n');
			await repo.write('keep.txt', 'k\n');
			await repo.commit('first');
			await fsp.rm(path.join(repo.root, 'a'));
			await repo.write('a/x.txt', 'inside\n');
			await repo.write('a/y.txt', 'sibling\n');
			const changes = await readChanges(repo.ports);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['a', 'a/x.txt']));
			expect((await repo.git(['ls-tree', '-r', '--name-only', tree])).stdout.trim().split('\n')).toEqual(['a/x.txt', 'keep.txt']);
		});

		test.skipIf(process.platform === 'win32')('content and executable bit both changed: all hunks give the new mode, some keep the old one', async () => {
			const repo = await create();
			await repo.write('run.sh', numbered(40).join(''));
			await repo.commit('first');
			await repo.write('run.sh', numbered(40).join('').replace('line 3\n', 'three\n').replace('line 35\n', 'late\n'));
			await fsp.chmod(path.join(repo.root, 'run.sh'), 0o755);
			const changes = await readChanges(repo.ports);
			const hunks = fileNamed(changes, 'run.sh').hunks;
			expect(hunks).toHaveLength(2);
			const all = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf(hunks.map(hunk => hunk.id)));
			expect((await repo.git(['ls-tree', all.tree, 'run.sh'])).stdout).toMatch(/^100755 /);
			expect(all.partialFiles).toEqual([]);
			const some = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([hunks[1].id]));
			expect((await repo.git(['ls-tree', some.tree, 'run.sh'])).stdout).toMatch(/^100644 /);
			expect(some.partialFiles).toEqual(['run.sh']);
		});

		test('a force-added file that matches an ignore rule is included with its edited content', async () => {
			const repo = await create();
			await repo.write('.gitignore', '*.log\n');
			await repo.write('x.log', 'one\n');
			await repo.git(['add', '-f', 'x.log']);
			await repo.commit('first');
			await repo.write('x.log', 'two\n');
			const changes = await readChanges(repo.ports);
			expect(changes.files.map(file => file.path)).toEqual(['x.log']);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['x.log']));
			expect(await show(repo, tree, 'x.log')).toBe('two\n');
		});
	});

	describe('renames across chunks', () => {
		test('hunks of a renamed file split over consecutive chunks reach the new path', async () => {
			const repo = await create();
			await repo.write('old.txt', numbered(40).join(''));
			await repo.commit('first');
			await fsp.rename(path.join(repo.root, 'old.txt'), path.join(repo.root, 'new.txt'));
			await repo.write('new.txt', numbered(40).join('').replace('line 3\n', 'three\n').replace('line 35\n', 'late\n'));
			const changes = await readChanges(repo.ports);
			const file = fileNamed(changes, 'new.txt');
			expect(file.hunks).toHaveLength(2);
			const first = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([file.hunks[0].id]));
			const second = await treeForChunk(repo.ports, first.tree, changes, chunkOf([file.hunks[1].id]));
			expect((await repo.git(['ls-tree', '-r', '--name-only', second.tree])).stdout.trim()).toBe('new.txt');
			expect(await show(repo, second.tree, 'new.txt')).toBe(await repo.read('new.txt'));
		});
	});

	describe('git configuration', () => {
		test('diff.submodule=log and diff.mnemonicPrefix=true do not change the patches', async () => {
			const repo = await create();
			await repo.git(['config', 'diff.submodule', 'log']);
			await repo.git(['config', 'diff.mnemonicPrefix', 'true']);
			await repo.git(['config', 'diff.noprefix', 'true']);
			await repo.git(['config', 'core.quotepath', 'true']);
			await repo.write('n\u00e4me.txt', numbered(40).join(''));
			await repo.commit('first');
			await repo.write('n\u00e4me.txt', numbered(40).join('').replace('line 3\n', 'three\n').replace('line 35\n', 'late\n'));
			const changes = await readChanges(repo.ports);
			const file = fileNamed(changes, 'n\u00e4me.txt');
			expect(file.hunks).toHaveLength(2);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([file.hunks[1].id]));
			expect(await show(repo, tree, 'n\u00e4me.txt')).toBe(numbered(40).join('').replace('line 35\n', 'late\n'));
		});

		test('diff.orderFile does not attach hunks to the wrong file', async () => {
			const repo = await create();
			await repo.write('a.txt', numbered(10).join(''));
			await repo.write('b.txt', numbered(10).join(''));
			await repo.commit('first');
			await repo.write('a.txt', numbered(10).join('').replace('line 5\n', 'alpha\n'));
			await repo.write('b.txt', numbered(10).join('').replace('line 5\n', 'bravo\n'));
			const order = path.join(path.dirname(repo.root), 'order.txt');
			await fsp.writeFile(order, 'b.txt\na.txt\n');
			await repo.git(['config', 'diff.orderFile', order]);
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'a.txt').hunks[0].patch).toContain('+alpha');
			expect(fileNamed(changes, 'b.txt').hunks[0].patch).toContain('+bravo');
			expect(fileNamed(changes, 'a.txt').hunks[0].patch).not.toContain('bravo');
		});

		test('diff.ignoreSubmodules=all still lists a changed submodule', async () => {
			const repo = await create();
			await repo.git(['config', 'diff.ignoreSubmodules', 'all']);
			await repo.write('a.txt', 'a\n');
			await repo.commit('first');
			const inSub = (args: string[]) => repo.git(['-C', 'sub', '-c', 'user.name=n', '-c', 'user.email=n@example.com', ...args]);
			await repo.git(['init', '-q', '-b', 'main', 'sub']);
			await inSub(['commit', '-q', '--allow-empty', '-m', 'one']);
			const sha = (await inSub(['rev-parse', 'HEAD'])).stdout.trim();
			await repo.git(['update-index', '--add', '--cacheinfo', `160000,${sha},sub`]);
			await repo.commit('add submodule entry');
			await inSub(['commit', '-q', '--allow-empty', '-m', 'two']);
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'sub')).toMatchObject({ binary: true, hunks: [] });
		});

		test('a repository with SHA-256 object names works with no checkpoints', async () => {
			const repo = await tempRepo({ init: 'none' });
			repos.push(repo);
			const init = await repo.git(['init', '--object-format=sha256', '-b', 'main']);
			if (init.exitCode !== 0) {
				return;
			}
			await repo.git(['config', 'user.name', 'T']);
			await repo.git(['config', 'user.email', 't@example.com']);
			await repo.write('a.txt', 'one\n');
			const changes = await readChanges(repo.ports);
			const base = (await repo.git(['hash-object', '-t', 'tree', '--stdin'], { stdin: '' })).stdout.trim();
			const { tree } = await treeForChunk(repo.ports, base, changes, chunkOf([], ['a.txt']));
			expect(tree).toHaveLength(64);
			expect(await show(repo, tree, 'a.txt')).toBe('one\n');
		});
	});

	describe('large files', () => {
		test('a new file over the large file limit is listed, in the basis, and included whole from disk', async () => {
			const repo = await create();
			await repo.write('a.txt', 'one\n');
			await repo.commit('first');
			const big = path.join(repo.root, 'big.bin');
			await fsp.writeFile(big, '');
			await fsp.truncate(big, LARGE_FILE_BYTES + 1);
			const changes = await readChanges(repo.ports);
			expect(changes.files).toEqual([{ path: 'big.bin', status: 'added', binary: true, sizeBytes: LARGE_FILE_BYTES + 1, tooLarge: true, hunks: [] }]);
			await fsp.truncate(big, LARGE_FILE_BYTES + 2);
			expect((await readChanges(repo.ports)).basis).not.toBe(changes.basis);
			const current = await readChanges(repo.ports);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), current, chunkOf([], ['big.bin']));
			expect((await repo.git(['ls-tree', '-l', tree, 'big.bin'])).stdout).toContain(String(LARGE_FILE_BYTES + 2));
		});

		test('a large staged new file comes from the reviewed tree with its mode', async () => {
			const repo = await create();
			await repo.write('a.txt', 'one\n');
			await repo.commit('first');
			const big = path.join(repo.root, 'big.bin');
			await fsp.writeFile(big, '');
			await fsp.truncate(big, LARGE_FILE_BYTES + 1);
			await fsp.chmod(big, 0o755);
			await repo.git(['add', 'big.bin']);
			const changes = await readChanges(repo.ports);
			expect(fileNamed(changes, 'big.bin')).toMatchObject({ status: 'added', tooLarge: true });
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['big.bin']));
			expect((await repo.git(['ls-tree', tree, 'big.bin'])).stdout).toMatch(process.platform === 'win32' ? /^1006/ : /^100755 /);
		});

		test('a file over the patch size limit is listed without hunks and the others keep theirs', async () => {
			const repo = await create();
			const line = 'x'.repeat(99) + '\n';
			const bigText = (last: string) => line.repeat(Math.ceil(MAX_PATCH_FILE_BYTES / 100) + 10) + last;
			await repo.write('big.txt', bigText('end\n'));
			await repo.write('small.txt', numbered(40).join(''));
			await repo.commit('first');
			await repo.write('big.txt', bigText('changed\n'));
			await repo.write('small.txt', numbered(40).join('').replace('line 3\n', 'three\n'));
			const changes = await readChanges(repo.ports);
			expect(changes.files.map(file => [file.path, file.binary, file.hunks.length])).toEqual([['big.txt', true, 0], ['small.txt', false, 1]]);
			const { tree } = await treeForChunk(repo.ports, await headTree(repo), changes, chunkOf([], ['big.txt']));
			expect((await show(repo, tree, 'big.txt')).endsWith('changed\n')).toBe(true);
		});

		test('a large new file that changes while it is hashed throws changes-moved', async () => {
			const repo = await create();
			await repo.write('a.txt', 'one\n');
			await repo.commit('first');
			const big = path.join(repo.root, 'big.bin');
			await fsp.writeFile(big, '');
			await fsp.truncate(big, LARGE_FILE_BYTES + 1);
			const changes = await readChanges(repo.ports);
			const ports = {
				...repo.ports,
				git: async (args: string[], options?: Parameters<TempRepo['git']>[1]) => {
					const result = await repo.ports.git(args, options);
					if (args.includes('hash-object') && args.includes('big.bin')) {
						await fsp.truncate(big, LARGE_FILE_BYTES + 2);
					}
					return result;
				},
			};
			const error = await treeForChunk(ports, await headTree(repo), changes, chunkOf([], ['big.bin'])).catch(caught => caught);
			expect(error).toBeInstanceOf(ChunkError);
			expect((error as ChunkError).code).toBe('changes-moved');
		});

		test('patches whose files add up to more than the total limit leave out the largest files', async () => {
			const repo = await create();
			const line = 'x'.repeat(99) + '\n';
			const lines = (bytes: number) => line.repeat(Math.floor(bytes / 100));
			const each = Math.floor(MAX_PATCH_FILE_BYTES * 0.9);
			const count = Math.ceil(MAX_PATCH_TOTAL_BYTES / each);
			const largest = lines(MAX_PATCH_FILE_BYTES - 1000);
			await repo.write('largest.txt', largest);
			for (let index = 0; index < count; index++) {
				await repo.write(`part${index}.txt`, lines(each));
			}
			await repo.write('small.txt', numbered(10).join(''));
			const changes = await readChanges(repo.ports);
			const patched = changes.files.filter(file => !file.binary);
			expect(patched.reduce((total, file) => total + file.sizeBytes, 0)).toBeLessThanOrEqual(MAX_PATCH_TOTAL_BYTES);
			expect(fileNamed(changes, 'largest.txt')).toMatchObject({ binary: true, hunks: [] });
			expect(fileNamed(changes, 'small.txt')).toMatchObject({ binary: false, hunks: [expect.anything()] });
			const { tree } = await treeForChunk(repo.ports, EMPTY_TREE, changes, chunkOf([], ['largest.txt']));
			expect((await repo.git(['ls-tree', '-l', tree, 'largest.txt'])).stdout).toContain(` ${largest.length}\t`);
		});
	});

	describe('submodules', () => {
		test('a text file that mentions a subproject commit still has hunks', async () => {
			const repo = await create();
			await repo.write('a.txt', 'one\n');
			await repo.commit('first');
			await repo.write('a.txt', 'Subproject commit abc\n');
			expect(fileNamed(await readChanges(repo.ports), 'a.txt')).toMatchObject({ binary: false, hunks: [expect.anything()] });
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
