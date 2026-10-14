/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { canCreateFolderIn } from './canCreateFolder';

// Windows has no POSIX write bit to clear, and root can write to any folder.
const canTestPermissions = process.platform !== 'win32' && process.getuid?.() !== 0;

describe('canCreateFolderIn', () => {
	let root: string;

	beforeEach(async () => {
		root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'can-create-folder-'));
	});

	afterEach(async () => {
		await fs.promises.chmod(root, 0o700);
		await fs.promises.rm(root, { recursive: true, force: true });
	});

	it('answers true for a folder the user can write to', async () => {
		expect(await canCreateFolderIn(root)).toBe(true);
	});

	it.runIf(canTestPermissions)('answers false for a folder the user cannot write to', async () => {
		await fs.promises.chmod(root, 0o555);

		expect(await canCreateFolderIn(root)).toBe(false);
	});

	it.runIf(canTestPermissions)('answers false for a folder the user can write to but not search', async () => {
		// Creating an entry in a folder needs its execute (search) bit as well as its write bit.
		await fs.promises.chmod(root, 0o600);

		expect(await canCreateFolderIn(root)).toBe(false);
	});

	it('answers for a folder that does not exist yet from the nearest folder above it', async () => {
		// Git creates missing parent folders when it clones, so these are checked too.
		expect(await canCreateFolderIn(path.join(root, 'missing', 'nested'))).toBe(true);
	});

	it.runIf(canTestPermissions)('answers false for a folder that does not exist yet under one the user cannot write to', async () => {
		await fs.promises.chmod(root, 0o555);

		expect(await canCreateFolderIn(path.join(root, 'missing', 'nested'))).toBe(false);
	});

	it('cannot tell for a path under a file', async () => {
		const file = path.join(root, 'file');
		await fs.promises.writeFile(file, '');

		expect(await canCreateFolderIn(path.join(file, 'nested'))).toBeUndefined();
	});
});
