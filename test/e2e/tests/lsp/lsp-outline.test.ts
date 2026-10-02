/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { Outline } from '../../pages/outline.js';
import { test, expect, tags } from '../_test.setup.js';

const R_FILE = 'basic-outline-with-vars.r';
const PY_FILE = 'basic-outline-with-vars.py';

test.use({
	suiteId: __filename
});

test.describe('Outline', { tag: [tags.WEB, tags.PYREFLY] }, () => {

	test.afterAll(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.describe('Outline: Sessions', () => {

		test.beforeAll(async function ({ app, openFile, hotKeys }) {
			const { outline } = app.workbench;

			await openFile(`workspaces/outline/${PY_FILE}`);
			await openFile(`workspaces/outline/${R_FILE}`);

			await hotKeys.closeSecondarySidebar();
			await outline.focus();
		});

		test('Verify outline is based on editor and per session', async function ({ app, sessions }) {
			const { outline, console, editor } = app.workbench;

			// No active session: Pyrefly serves Python symbols without one, Ark does not
			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);
			await editor.selectTab(R_FILE);
			await outline.expectOutlineToBeEmpty();

			// Start sessions
			const [pySession1, pySession2, rSession1, rSession2] = await sessions.start(['python', 'pythonAlt', 'r', 'rAlt']);

			// Select Python file
			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);

			// Select R Session 1 - verify Python outline
			// Use last-active Python session's LSP for Python files, even if foreground session is R.
			await sessions.select(rSession1.id);
			await verifyOutline(outline);

			// Select Python Session 1 - verify Python outline
			await sessions.select(pySession1.id);
			await console.typeToConsole('global_variable="goodbye"', true);
			await verifyOutline(outline);

			// Select R file
			await editor.selectTab(R_FILE);
			await verifyOutline(outline);

			// Select R Session 1 - verify R outline
			await sessions.select(rSession1.id);
			await verifyOutline(outline);

			// Select R Session 2 - verify R outline
			await sessions.select(rSession2.id);
			await verifyOutline(outline);

			// Select Python file - verify Python outline
			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);

			// Python Session 2 - verify Python outline
			await sessions.select(pySession2.id);
			await console.typeToConsole('global_variable="goodbye2"', true);
			await verifyOutline(outline);
		});

		test('Verify outline after reload with Python in foreground and R in background', {
			tag: [tags.ARK],
		}, async function ({ app, hotKeys, sessions }) {
			const { outline, editor } = app.workbench;

			// Start sessions
			await sessions.deleteAll();
			await sessions.start(['python', 'r']);

			// Verify outlines for both file types
			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);

			await editor.selectTab(R_FILE);
			await verifyOutline(outline);

			// Reload window
			await sessions.expectSessionCountToBe(2);
			await hotKeys.reloadWindow(true);
			await sessions.expectSessionCountToBe(2);

			// Verify outlines for both file types
			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);

			await editor.selectTab(R_FILE);
			await verifyOutline(outline);
		});

		test('Verify outline after reload with R in foreground and Python in background', {
			tag: [tags.ARK],
		}, async function ({ app, hotKeys, sessions }) {
			const { outline, editor } = app.workbench;

			// Start sessions
			await sessions.deleteAll();
			await sessions.start(['r', 'python']);

			// Verify outlines for both file types
			await editor.selectTab(R_FILE);
			await verifyOutline(outline);

			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);

			// Reload window
			await hotKeys.reloadWindow(true);

			// Verify outlines for both file types
			await editor.selectTab(R_FILE);
			await verifyOutline(outline);

			await editor.selectTab(PY_FILE);
			await verifyOutline(outline);
		});
	});

	test.describe('Outline: Basic', () => {
		test('R - Verify Outline Contents', {
			tag: [tags.ARK]
		}, async function ({ app, r, openFile }) {
			await openFile(join('workspaces', 'chinook-db-r', 'chinook-sqlite.r'));
			await app.workbench.outline.expectOutlineToContain([
				'con',
				'albums',
				'df',
			]);
		});

		test('Python - Verify Outline Contents', async function ({ app, python, openFile }) {
			await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));

			await expect(async () => {
				try {
					await app.workbench.outline.expectOutlineToContain([
						'data_file_path',
						'conn',
						'cur',
						'rows',
						'df'
					]);
				} catch (e) {
					await app.code.driver.currentPage.keyboard.press('PageDown');
					await app.code.driver.currentPage.keyboard.press('End');
					await app.code.driver.currentPage.keyboard.press('Enter');
					await app.code.driver.currentPage.keyboard.press('Enter');
					throw e;
				}
			}).toPass({ timeout: 60000 });
		});
	});

});

// Child rows depend on the LSP and on the tree's expansion state, so only the top
// level is compared; an exact match also proves no duplicates from multiple sessions.
async function verifyOutline(outline: Outline) {
	await expect.poll(async () => {
		const rows = await outline.getOutlineRows();
		return rows.filter(row => row.level === 1).map(row => row.label).sort();
	}).toEqual(['demonstrate_scope', 'global_variable']);
}
