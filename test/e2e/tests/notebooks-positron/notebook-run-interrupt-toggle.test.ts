/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Run All / Interrupt Toggle', {
	tag: [tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Python - Run All toggles to Interrupt during execution, cancels, and prevents subsequent cells', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10493' }]
	}, async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.currentPage.keyboard;
		const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
		const runAllOrInterrupt = `${mod}+Shift+Enter`;

		await test.step('Create notebook with infinite loop followed by a print cell', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'while True: pass', { run: false });
			await notebooksPositron.addCell('code');
			await notebooksPositron.addCodeToCell(1, 'print("This should NOT be printed")', { run: false });
		});

		await test.step('Trigger Run All via keyboard shortcut', async () => {
			// Exit edit mode first: while a code cell editor is focused,
			// Cmd/Ctrl+Shift+Enter runs the selection in the cell (#3804). Run
			// All / Interrupt own the shortcut in command mode.
			await notebooksPositron.selectCellAtIndex(0, { editMode: false });
			await keyboard.press(runAllOrInterrupt);
		});

		await test.step('Verify cell is executing', async () => {
			await notebooksPositron.expectSpinnerAtIndex(0, true, 10000);
		});

		await test.step('Trigger Interrupt via keyboard shortcut', async () => {
			await keyboard.press(runAllOrInterrupt);
		});

		await test.step('Verify execution was interrupted', async () => {
			await notebooksPositron.expectNoActiveSpinners(30000);
			await expect(notebooksPositron.cellOutput(0)).toContainText('keyboard interrupt', { timeout: 10000 });
		});

		await test.step('Verify second cell was NOT executed', async () => {
			await expect(notebooksPositron.cellOutput(1)).not.toContainText('This should NOT be printed');
		});
	});
});
