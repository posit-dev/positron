/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as path from 'path';
import { splitZ } from './git';
import { tempRepo, TempRepo } from './test/tempRepo';
import { indexTree, LARGE_FILE_BYTES, saveSnapshot, withTempIndex, worktreeTree } from './trees';

describe('trees', () => {
	const repos: TempRepo[] = [];
	const create = async () => {
		const repo = await tempRepo();
		repos.push(repo);
		return repo;
	};
	const ls = async (repo: TempRepo, tree: string) =>
		splitZ((await repo.git(['ls-tree', '-r', '-z', '--name-only', tree])).stdout);

	afterEach(async () => {
		await Promise.all(repos.splice(0).map(repo => repo.dispose()));
	});

	test('worktreeTree includes tracked edits and untracked files', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.write('gone.txt', 'bye\n');
		await repo.commit('first');
		await repo.write('a.txt', 'two\n');
		await fsp.rm(path.join(repo.root, 'gone.txt'));
		await repo.write('new dir/n\u00e4me.txt', 'new\n');
		const { tree, skipped } = await worktreeTree(repo.ports);
		expect(skipped).toEqual([]);
		expect(await ls(repo, tree)).toEqual(['a.txt', 'new dir/n\u00e4me.txt']);
		expect((await repo.git(['show', `${tree}:a.txt`])).stdout).toBe('two\n');
	});

	test('worktreeTree excludes ignored files', async () => {
		const repo = await create();
		await repo.write('.gitignore', '*.log\nbuild/\n');
		await repo.write('keep.txt', 'k\n');
		await repo.commit('first');
		await repo.write('debug.log', 'x\n');
		await repo.write('build/out.bin', 'x\n');
		const { tree } = await worktreeTree(repo.ports);
		expect(await ls(repo, tree)).toEqual(['.gitignore', 'keep.txt']);
	});

	test('worktreeTree skips an untracked file over 50 MB and lists it', async () => {
		const repo = await create();
		await repo.write('small.txt', 's\n');
		await fsp.writeFile(path.join(repo.root, 'big.bin'), '');
		await fsp.truncate(path.join(repo.root, 'big.bin'), LARGE_FILE_BYTES + 1);
		const { tree, skipped } = await worktreeTree(repo.ports);
		expect(skipped).toEqual(['big.bin']);
		expect(await ls(repo, tree)).toEqual(['small.txt']);
	});

	test('worktreeTree keeps a tracked file over 50 MB', async () => {
		const repo = await create();
		await repo.write('tracked.txt', 'x'.repeat(100));
		await repo.write('untracked.txt', 'y'.repeat(100));
		await repo.commit('first');
		await repo.write('tracked.txt', 'z'.repeat(100));
		await repo.write('untracked.txt', 'y'.repeat(100));
		await repo.git(['rm', '--cached', '-q', 'untracked.txt']);
		const { tree, skipped } = await worktreeTree(repo.ports, 10);
		expect(skipped).toEqual(['untracked.txt']);
		expect(await ls(repo, tree)).toEqual(['tracked.txt']);
		expect((await repo.git(['show', `${tree}:tracked.txt`])).stdout).toBe('z'.repeat(100));
	});

	test.skipIf(process.platform === 'win32')('worktreeTree keeps the executable bit and symbolic links', async () => {
		const repo = await create();
		await repo.write('run.sh', '#!/bin/sh\n');
		await fsp.chmod(path.join(repo.root, 'run.sh'), 0o755);
		await fsp.symlink('run.sh', path.join(repo.root, 'link'));
		const { tree } = await worktreeTree(repo.ports);
		const entries = (await repo.git(['ls-tree', tree])).stdout.trim().split('\n');
		expect(entries.map(line => line.split(/\s+/).slice(0, 2).join(' ')).sort()).toEqual(['100755 blob', '120000 blob']);
		expect((await repo.git(['show', `${tree}:link`])).stdout).toBe('run.sh');
	});

	test('worktreeTree leaves the real index unchanged', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.commit('first');
		await repo.write('staged.txt', 's\n');
		await repo.git(['add', 'staged.txt']);
		await repo.write('a.txt', 'two\n');
		await repo.write('untracked.txt', 'u\n');
		const before = await indexTree(repo.ports);
		const indexBytes = await fsp.readFile(path.join(repo.root, '.git', 'index'));
		await worktreeTree(repo.ports);
		expect(await indexTree(repo.ports)).toBe(before);
		expect(await fsp.readFile(path.join(repo.root, '.git', 'index'))).toEqual(indexBytes);
		expect(await ls(repo, before)).toEqual(['a.txt', 'staged.txt']);
		expect(await fsp.readdir(path.join(repo.root, '.git', 'positron-checkpoints', 'tmp'))).toEqual(['.keep']);
	});

	test('withTempIndex removes the temporary index even when the callback fails', async () => {
		const repo = await create();
		let indexFile = '';
		await expect(withTempIndex(repo.ports, async env => {
			indexFile = env.GIT_INDEX_FILE;
			await repo.git(['read-tree', '--empty'], { env });
			await expect(fsp.stat(indexFile)).resolves.toBeDefined();
			throw new Error('boom');
		})).rejects.toThrow('boom');
		await expect(fsp.stat(indexFile)).rejects.toThrow();
		expect(indexFile).toContain(path.join('.git', 'positron-checkpoints', 'tmp'));
	});

	test('saveSnapshot creates a ref that git push does not send', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const head = await repo.commit('first');
		const other = await repo.clone();
		repos.push(other);
		await repo.write('a.txt', 'two\n');
		await repo.write('b.txt', 'new\n');
		repo.clock.advance(1000);
		const snapshot = await saveSnapshot(repo.ports, 'op-9', head);
		expect(snapshot.ref).toBe('refs/positron-checkpoints/snapshots/op-9');
		expect((await repo.git(['rev-parse', snapshot.ref])).stdout.trim()).toBe(snapshot.commit);
		expect(await ls(repo, snapshot.commit)).toEqual(['a.txt', 'b.txt']);
		expect((await repo.git(['rev-parse', `${snapshot.commit}^{tree}`])).stdout.trim()).toBe(snapshot.worktreeTree);
		expect((await repo.git(['rev-parse', `${snapshot.commit}^`])).stdout.trim()).toBe(head);
		expect((await repo.git(['rev-parse', `${snapshot.commit}^2^{tree}`])).stdout.trim()).toBe(snapshot.indexTree);

		await repo.git(['push', 'origin', 'main']);
		const remoteRefs = (await repo.git(['ls-remote', 'origin'])).stdout;
		expect(remoteRefs).toContain('refs/heads/main');
		expect(remoteRefs).not.toContain('positron-checkpoints');
	});

	test('saveSnapshot keeps the blobs of a staged and then edited file reachable', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const head = await repo.commit('first');
		await repo.write('a.txt', 'staged only\n');
		await repo.git(['add', 'a.txt']);
		await repo.write('a.txt', 'edited again\n');
		const snapshot = await saveSnapshot(repo.ports, 'op-1', head);
		const stagedBlob = (await repo.git(['rev-parse', `${snapshot.indexTree}:a.txt`])).stdout.trim();
		const workBlob = (await repo.git(['rev-parse', `${snapshot.worktreeTree}:a.txt`])).stdout.trim();
		expect(stagedBlob).not.toBe(workBlob);
		const reachable = (await repo.git(['rev-list', '--objects', snapshot.ref])).stdout;
		expect(reachable).toContain(stagedBlob);
		expect(reachable).toContain(workBlob);
		expect(reachable).toContain(snapshot.indexTree);
		expect((await repo.git(['rev-parse', `${snapshot.commit}^`])).stdout.trim()).toBe(head);
	});

	test('saveSnapshot does not sign, even when signing is enabled and the signer fails', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		await repo.git(['config', 'commit.gpgsign', 'true']);
		await repo.git(['config', 'gpg.program', 'false']);
		const snapshot = await saveSnapshot(repo.ports, 'op-1');
		expect((await repo.git(['cat-file', 'commit', snapshot.commit])).stdout).not.toContain('gpgsig');
	});

	test('saveSnapshot refuses to replace the snapshot of a reused operation id', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const first = await saveSnapshot(repo.ports, 'op-1');
		await repo.write('a.txt', 'two\n');
		await expect(saveSnapshot(repo.ports, 'op-1')).rejects.toThrow();
		expect((await repo.git(['rev-parse', first.ref])).stdout.trim()).toBe(first.commit);
	});

	test.skipIf(process.platform === 'win32')('worktreeTree stores an untracked symbolic link to a large file as a link', async () => {
		const repo = await create();
		await repo.write('big.bin', 'x'.repeat(100));
		await fsp.symlink('big.bin', path.join(repo.root, 'link'));
		const { tree, skipped } = await worktreeTree(repo.ports, 10);
		expect(skipped).toEqual(['big.bin']);
		expect(await ls(repo, tree)).toEqual(['link']);
		expect((await repo.git(['ls-tree', tree, 'link'])).stdout).toMatch(/^120000 /);
	});

	test('saveSnapshot works with no checkpoints yet', async () => {
		const repo = await create();
		await repo.write('a.txt', 'one\n');
		const snapshot = await saveSnapshot(repo.ports, 'op-1');
		expect(await ls(repo, snapshot.commit)).toEqual(['a.txt']);
		// The only parent is the commit that holds the index tree.
		expect((await repo.git(['rev-parse', `${snapshot.commit}^1^{tree}`])).stdout.trim()).toBe(snapshot.indexTree);
		expect((await repo.git(['rev-parse', '--verify', '-q', `${snapshot.commit}^2`])).exitCode).not.toBe(0);
		expect((await repo.git(['rev-parse', '--verify', '-q', 'HEAD'])).exitCode).not.toBe(0);
		expect(snapshot.indexTree).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
	});
});
