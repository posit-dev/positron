/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
A workspace venv deleted and then recreated outside Positron must come back in the
session picker (#4556).

This needs the real file watcher. On Linux it reports a new `.venv` folder but not
the `bin/python` created inside it, so nothing re-added the venv. The re-add logic
itself is unit tested in positron-python's nativeAPI.unit.test.ts with a mocked
watcher; this covers what those can't.

A global Python session is started first so the venv is not the selected
interpreter: deleting the selected interpreter re-adds it through a separate path,
which would hide the bug.
*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { test, expect, tags } from '../_test.setup';

const execFileAsync = promisify(execFile);

test.use({
	suiteId: __filename
});

test.describe('Python Venv Recreated Outside Positron', {
	tag: [tags.INTERPRETER]
}, () => {
	test.skip(process.env.IS_OPENSUSE === 'true', 'Skip on openSuse');

	test('Recreated venv stays in the session picker', async function ({ app, openFolder, sessions }) {
		const workspace = path.join(os.tmpdir(), 'vscsmoke', 'test-files', 'venv-recreate-test');
		const venvPath = path.join(workspace, '.venv');
		const createVenv = () => execFileAsync('python3', ['-m', 'venv', '--without-pip', venvPath]);
		const venvListed = async () => {
			const runtimes = await sessions.getAllAvailableRuntimes();
			return runtimes.some(runtime => runtime.path.includes(path.join('venv-recreate-test', '.venv')));
		};

		await fs.promises.mkdir(workspace, { recursive: true });
		await createVenv();

		try {
			await openFolder('test-files/venv-recreate-test');
			await sessions.expectNoStartUpMessaging();
			await sessions.start('python');
			await expect.poll(venvListed, { timeout: 60000 }).toBe(true);

			// Wait for the delete to be picked up before recreating, so the last check
			// can only pass if the recreated venv is added back.
			await fs.promises.rm(venvPath, { recursive: true, force: true });
			await expect.poll(venvListed, { timeout: 60000 }).toBe(false);

			await createVenv();
			await expect.poll(venvListed, { timeout: 60000 }).toBe(true);
		} finally {
			await fs.promises.rm(workspace, { recursive: true, force: true }).catch(() => { });
		}
	});
});
