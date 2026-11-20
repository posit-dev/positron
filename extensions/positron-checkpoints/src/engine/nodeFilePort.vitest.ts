/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createNodeFilePort } from './nodeFilePort';
import { FilePort } from './ports';

describe('createNodeFilePort', () => {
	let root: string;
	let files: FilePort;

	beforeEach(async () => {
		root = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-files-'));
		files = createNodeFilePort(root);
	});

	afterEach(async () => {
		await fsp.rm(root, { recursive: true, force: true });
	});

	test('writes, reads, stats, moves, and removes files relative to the root', async () => {
		await files.write('dir/a.txt', new TextEncoder().encode('hello'), false);
		expect(new TextDecoder().decode(await files.read('dir/a.txt'))).toBe('hello');
		expect(await files.stat('dir/a.txt')).toEqual({ sizeBytes: 5, isDirectory: false });
		expect(await files.stat('dir')).toEqual({ sizeBytes: expect.any(Number), isDirectory: true });

		await files.move('dir/a.txt', 'other/b.txt');
		expect(await files.read('dir/a.txt')).toBeUndefined();
		expect(await files.stat('other/b.txt')).toMatchObject({ sizeBytes: 5 });

		await files.remove('other/b.txt');
		expect(await files.stat('other/b.txt')).toBeUndefined();
		await expect(files.remove('other/b.txt')).resolves.toBeUndefined();
	});

	test('sets the executable bit when asked', async () => {
		if (process.platform === 'win32') {
			return;
		}
		await files.write('run.sh', new Uint8Array(), true);
		expect((await fsp.stat(path.join(root, 'run.sh'))).mode & 0o111).not.toBe(0);
		await files.write('run.sh', new Uint8Array(), false);
		expect((await fsp.stat(path.join(root, 'run.sh'))).mode & 0o111).toBe(0);
	});

	test.skipIf(process.platform === 'win32')('sets the owner execute bit on a file without read permission', async () => {
		await files.write('locked.sh', new Uint8Array(), false);
		await fsp.chmod(path.join(root, 'locked.sh'), 0o200);
		await files.write('locked.sh', new Uint8Array(), true);
		expect((await fsp.stat(path.join(root, 'locked.sh'))).mode & 0o777).toBe(0o300);
	});

	test('copyKeepingTime copies the content and the modification time', async () => {
		await files.write('a/index', new TextEncoder().encode('data'), false);
		const old = new Date('2020-01-02T03:04:05.678Z');
		await fsp.utimes(path.join(root, 'a/index'), old, old);
		await files.write('b/copy', new TextEncoder().encode('previous'), false);
		await files.copyKeepingTime('a/index', 'b/copy');
		expect(new TextDecoder().decode(await files.read('b/copy'))).toBe('data');
		expect((await fsp.stat(path.join(root, 'b/copy'))).mtime.getTime()).toBe(old.getTime());
		await expect(files.copyKeepingTime('a/index', '../escape')).rejects.toThrow();
	});

	test.skipIf(process.platform === 'win32')('appendDurable refuses a symbolic link as the final component', async () => {
		await fsp.writeFile(path.join(root, 'target'), 'keep\n');
		await fsp.symlink('target', path.join(root, 'link'));
		await expect(files.appendDurable('link', 'x\n')).rejects.toThrow();
		expect(await fsp.readFile(path.join(root, 'target'), 'utf8')).toBe('keep\n');
	});

	test('lstat reports the modification time', async () => {
		await files.write('a', new Uint8Array(), false);
		const when = new Date('2021-03-04T05:06:07Z');
		await fsp.utimes(path.join(root, 'a'), when, when);
		expect((await files.lstat('a'))?.mtimeMs).toBe(when.getTime());
	});

	test('appendDurable appends the text exactly as given', async () => {
		await files.appendDurable('log/journal', 'one\n');
		await files.appendDurable('log/journal', 'two\n');
		expect(await fsp.readFile(path.join(root, 'log/journal'), 'utf8')).toBe('one\ntwo\n');
	});

	test('refuses a path outside the root', async () => {
		await expect(files.read('../escape.txt')).rejects.toThrow();
	});

	test('accepts in-project names that start with two dots', async () => {
		await files.write('..notes', new TextEncoder().encode('x'), false);
		expect(await files.stat('..notes')).toMatchObject({ sizeBytes: 1 });
		await files.write('..dir/a.txt', new Uint8Array(), false);
		expect(await files.stat('..dir/a.txt')).toBeDefined();
		await expect(files.read('..')).rejects.toThrow();
		await expect(files.read('../x')).rejects.toThrow();
		await expect(files.read('a/../../x')).rejects.toThrow();
	});

	describe.skipIf(process.platform === 'win32')('symbolic links and permissions', () => {
		let outside: string;

		beforeEach(async () => {
			outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-outside-'));
		});

		afterEach(async () => {
			await fsp.rm(outside, { recursive: true, force: true });
		});

		test('refuses a path that leaves the root through a symbolic link', async () => {
			await fsp.symlink(outside, path.join(root, 'link'));
			await expect(files.write('link/secret.txt', new Uint8Array(), false)).rejects.toThrow(/outside the project/);
			await expect(files.write('link/new/secret.txt', new Uint8Array(), false)).rejects.toThrow(/outside the project/);
			await expect(files.read('link/x')).rejects.toThrow(/outside the project/);
			expect(await fsp.readdir(outside)).toEqual([]);
		});

		test('read, stat, and appendDurable refuse a final symbolic link that points outside', async () => {
			const target = path.join(outside, 'target.txt');
			await fsp.writeFile(target, 'secret');
			await fsp.symlink(target, path.join(root, 'file.txt'));
			await fsp.symlink(path.join(outside, 'missing.txt'), path.join(root, 'dangling.txt'));
			await expect(files.read('file.txt')).rejects.toThrow(/outside the project/);
			await expect(files.stat('file.txt')).rejects.toThrow(/outside the project/);
			await expect(files.appendDurable('file.txt', 'x')).rejects.toThrow(/outside the project/);
			await expect(files.appendDurable('dangling.txt', 'x')).rejects.toThrow(/outside the project/);
			expect(await fsp.readFile(target, 'utf8')).toBe('secret');
			expect(await fsp.readdir(outside)).toEqual(['target.txt']);
			expect(await files.lstat('file.txt')).toMatchObject({ isSymbolicLink: true, isDirectory: false });
			await files.remove('file.txt');
			expect(await fsp.readFile(target, 'utf8')).toBe('secret');
		});

		test('allows a symbolic link that stays inside the root', async () => {
			await fsp.mkdir(path.join(root, 'real'));
			await fsp.symlink(path.join(root, 'real'), path.join(root, 'alias'));
			await files.write('alias/a.txt', new TextEncoder().encode('in'), false);
			expect(await fsp.readFile(path.join(root, 'real/a.txt'), 'utf8')).toBe('in');
		});

		test('write replaces a symbolic link at the target instead of writing through it', async () => {
			const target = path.join(outside, 'target.txt');
			await fsp.writeFile(target, 'original');
			await fsp.symlink(target, path.join(root, 'file.txt'));
			await files.write('file.txt', new TextEncoder().encode('new'), false);
			expect(await fsp.readFile(target, 'utf8')).toBe('original');
			expect((await fsp.lstat(path.join(root, 'file.txt'))).isSymbolicLink()).toBe(false);
			expect(await fsp.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('new');
		});

		test('write keeps the permission bits of an existing file when toggling the executable bit', async () => {
			const file = path.join(root, 'private.txt');
			await fsp.writeFile(file, 'a');
			await fsp.chmod(file, 0o600);
			await files.write('private.txt', new TextEncoder().encode('b'), false);
			expect((await fsp.stat(file)).mode & 0o777).toBe(0o600);
			await files.write('private.txt', new TextEncoder().encode('c'), true);
			expect((await fsp.stat(file)).mode & 0o777).toBe(0o700);
			await files.write('private.txt', new TextEncoder().encode('d'), false);
			expect((await fsp.stat(file)).mode & 0o777).toBe(0o600);
		});

		test('write gives a new file the mode the umask allows', async () => {
			const previous = process.umask(0o077);
			try {
				await files.write('new.txt', new Uint8Array(), false);
				await files.write('new.sh', new Uint8Array(), true);
			} finally {
				process.umask(previous);
			}
			expect((await fsp.stat(path.join(root, 'new.txt'))).mode & 0o777).toBe(0o600);
			expect((await fsp.stat(path.join(root, 'new.sh'))).mode & 0o777).toBe(0o700);
		});
	});

	test('accepts an absolute path inside an extra root and refuses other absolute paths', async () => {
		const extra = await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-extra-'));
		try {
			const port = createNodeFilePort(root, [extra]);
			const inside = path.join(extra, 'sub', 'a.txt');
			await port.write(inside, new TextEncoder().encode('x'), false);
			expect(await fsp.readFile(inside, 'utf8')).toBe('x');
			expect(await port.stat(inside)).toMatchObject({ sizeBytes: 1 });
			await port.remove(inside);
			expect(await port.stat(inside)).toBeUndefined();
			await expect(port.read(path.join(os.tmpdir(), 'elsewhere.txt'))).rejects.toThrow(/outside the project/);
			await expect(files.read(path.join(extra, 'a.txt'))).rejects.toThrow(/outside the project/);
		} finally {
			await fsp.rm(extra, { recursive: true, force: true });
		}
	});

	test('caseInsensitive uses a unique probe name for each call', async () => {
		const other = createNodeFilePort(root);
		const [first, second] = await Promise.all([files.caseInsensitive(), other.caseInsensitive()]);
		expect(first).toBe(second);
		expect(await fsp.readdir(root)).toEqual([]);
	});

	test('caseInsensitive matches the file system and leaves no probe behind', async () => {
		await fsp.writeFile(path.join(root, 'Probe.txt'), '');
		const expected = await fsp.access(path.join(root, 'probe.txt')).then(() => true, () => false);
		await fsp.rm(path.join(root, 'Probe.txt'));

		expect(await files.caseInsensitive()).toBe(expected);
		expect(await fsp.readdir(root)).toEqual([]);
	});
});
