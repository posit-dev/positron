/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Kernel Behavior', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	// 	The button is disabled while shutting down after clicking
	// Existing execution orders shown in cells, and cell outputs shouldn't be cleared.
	// Can execute a cell afterwards, at which point existing execution should restart at [1]
	// Variable defined before restart is no longer available

	test('Notebook Session Start Up behavior', async function ({ app }) {
		const { notebooksPositron, variables } = app.workbench;

		// create new notebook with 1 cell
		await notebooksPositron.newNotebook(1);

		// workaround issue #
		if (app.web) {
			await notebooksPositron.kernel.kernelStatusBadge.click();
			await app.code.driver.page.waitForTimeout(1000);
			await app.code.driver.page.mouse.click(0, 0);
		}

		// ensure when no kernel is selected, restart/shutdown are disabled
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Change Kernel', visible: true, enabled: true },
			{ label: 'Open Notebook Console', visible: true, enabled: true },
			{ label: 'Restart Kernel', visible: true, enabled: false },
			{ label: 'Shutdown Kernel', visible: true, enabled: false },
		]);

		// select kernel and ensure while starting, restart/shutdown are disabled
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', visible: true, enabled: false },
			{ label: 'Shutdown Kernel', visible: true, enabled: false },
		]);

		// ensure once started, restart/shutdown are enabled
		await notebooksPositron.kernel.expectBadgeToContain('Python');
		await notebooksPositron.kernel.expectMenuToContain([
			{ label: 'Restart Kernel', visible: true, enabled: true },
			{ label: 'Shutdown Kernel', visible: true, enabled: true },
		]);

		// define variable X in cell 0 and execute
		await notebooksPositron.addCodeToCell(0, 'X = 10', { run: true });
		await variables.expectVariableToBe('X', '10');

		// restart kernel and ensure variable X is cleared
		await notebooksPositron.kernel.restart();
		await variables.expectVariableToNotExist('X');

		// restart kernel and ensure variable X is cleared
		// await notebooksPositron.kernel.restart();

		// restart kernel and ensure execution count and outputs persist
		// await notebooksPositron.kernel.restartKernel();
		// await notebooksPositron.expectCellExecutionCountToBe(0, 1);
		// await notebooksPositron.expectCellOutputToContain(0, ''); // no output expected

		// // execute cell 0 again and ensure execution count is now 2
		// await notebooksPositron.runCell(0);
		// await notebooksPositron.expectCellExecutionCountToBe(0, 2);
	});
});
