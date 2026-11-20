/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findRepository } from './repositoryMatch';

describe('findRepository', () => {
	const repository = (fsPath: string) => ({ rootUri: { fsPath }, name: fsPath });

	test('a repository opened through a symbolic link matches the resolved project root', async () => {
		const links: Record<string, string> = { '/work/link': '/data/project' };
		const realpath = async (folder: string) => links[folder] ?? folder;

		const found = await findRepository([repository('/work/other'), repository('/work/link')], '/data/project', realpath);

		expect(found?.name).toBe('/work/link');
	});

	test('no repository at the root is undefined, and a path that cannot be resolved is compared as it is', async () => {
		const realpath = async (folder: string) => {
			throw new Error(`ENOENT: ${folder}`);
		};

		expect(await findRepository([repository('/work/other')], '/work/project', realpath)).toBeUndefined();
		expect((await findRepository([repository('/work/project/')], '/work/project', realpath))?.name).toBe('/work/project/');
	});

	test.skipIf(process.platform === 'win32')('with the file system, a link to the root matches', async () => {
		const base = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'positron-checkpoints-match-')));
		try {
			const root = path.join(base, 'project');
			await fsp.mkdir(root);
			await fsp.symlink(root, path.join(base, 'link'));

			expect((await findRepository([repository(path.join(base, 'link'))], root))?.name).toBe(path.join(base, 'link'));
		} finally {
			await fsp.rm(base, { recursive: true, force: true });
		}
	});
});
