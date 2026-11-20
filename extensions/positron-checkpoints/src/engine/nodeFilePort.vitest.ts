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

	test('appendDurable appends the text exactly as given', async () => {
		await files.appendDurable('log/journal', 'one\n');
		await files.appendDurable('log/journal', 'two\n');
		expect(await fsp.readFile(path.join(root, 'log/journal'), 'utf8')).toBe('one\ntwo\n');
	});

	test('refuses a path outside the root', async () => {
		await expect(files.read('../escape.txt')).rejects.toThrow();
	});

	test('caseInsensitive matches the file system and leaves no probe behind', async () => {
		await fsp.writeFile(path.join(root, 'Probe.txt'), '');
		const expected = await fsp.access(path.join(root, 'probe.txt')).then(() => true, () => false);
		await fsp.rm(path.join(root, 'Probe.txt'));

		expect(await files.caseInsensitive()).toBe(expected);
		expect(await fsp.readdir(root)).toEqual([]);
	});
});
