/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { Page } from '@playwright/test';
import { Application } from '../../infra';
import { HotKeys } from '../../pages/hotKeys';
import { findExtHostLog } from '../../utils/memory/extensions';
import { test, expect, tags } from './_test.setup';

test.use({
	suiteId: __filename
});

/**
 * The Quarto extension's log, which is where it records each temporary
 * virtual document it creates. Empty when the log does not exist yet.
 */
async function readQuartoLog(logsPath: string): Promise<string> {
	const extHostLog = await findExtHostLog(logsPath);
	if (!extHostLog) {
		return '';
	}
	try {
		return await fs.readFile(join(dirname(extHostLog), 'quarto.quarto', 'Quarto.log'), 'utf8');
	} catch {
		return '';
	}
}

/**
 * Ask for each cell language feature once. Leaves the document reverted and
 * closed.
 */
async function exerciseCellFeatures(app: Application, page: Page, hotKeys: HotKeys, fileName: string): Promise<void> {
	const { editors, inlineQuarto, outline, quickaccess } = app.workbench;

	await editors.waitForActiveTab(fileName);
	await inlineQuarto.expectKernelStatusVisible();

	await test.step('Outline', async () => {
		// The chunk row, not a cell symbol: Python cells have none without
		// Pyrefly, and this step only needs the request to go out.
		await outline.focus();
		await outline.expectOutlineElementToBeVisible('(code cell)');
		await editors.selectTab(fileName);
	});

	await test.step('Hover', async () => {
		await inlineQuarto.gotoLine(11);
		await quickaccess.runCommand('editor.action.showHover');
		await page.keyboard.press('Escape');
	});

	await test.step('Format Document', async () => {
		await hotKeys.formatDocument();
	});

	await test.step('Run the cell, then Cmd+Enter on one statement', async () => {
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 11, outputLine: 14 });
		await editors.selectTab(fileName);
		// Nothing to wait for: the statement range is asked for before the code
		// is sent, and line 9 has no output.
		await inlineQuarto.gotoLine(9);
		await inlineQuarto.runCurrentCode();
	});

	await test.step('Completions', async () => {
		await inlineQuarto.gotoLine(11);
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('df', { delay: 100 });
		await expect(async () => {
			await page.keyboard.press('Control+Space');
			await expect(page.locator('.suggest-widget .monaco-list-row').first()).toBeVisible({ timeout: 5000 });
		}).toPass({ timeout: 30000 });
		await page.keyboard.press('Escape');
	});

	await quickaccess.runCommand('workbench.action.revertAndCloseActiveEditor');
}

// With `quarto.embeddedLanguageFeatures.native` on, Positron answers R and
// Python cell requests from its hidden notebook, so the Quarto extension writes
// no virtual document for either language. The two paths render the same
// results, so only the extension's log can tell them apart.
//
// Electron only: the web build does not write extension logs to disk.
test.describe('Quarto - No Virtual Documents', { tag: [tags.QUARTO, tags.ARK] }, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test('R and Python cell features create no virtual documents', async function ({ app, page, hotKeys, openFile, sessions, logsPath }) {
		await sessions.start(['r', 'python']);

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_r.rmd'));
		await exerciseCellFeatures(app, page, hotKeys, 'simple_r.rmd');

		await openFile(join('workspaces', 'quarto_inline_output', 'simple_py.qmd'));
		await exerciseCellFeatures(app, page, hotKeys, 'simple_py.qmd');

		// A missing or empty log would pass the vdoc check below, so first prove
		// this is the Quarto log and the extension found the host's cell commands.
		await expect.poll(() => readQuartoLog(logsPath)).toContain('[CellFeatures] Host owns Quarto cell language features');

		// Other languages (sql, bash, julia) still use virtual documents by design.
		const log = await readQuartoLog(logsPath);
		expect(log.match(/\[vdoc\] Created .*?\.vdoc\.[0-9a-f-]+\.(r|py)\b/gi) ?? []).toEqual([]);
	});
});
