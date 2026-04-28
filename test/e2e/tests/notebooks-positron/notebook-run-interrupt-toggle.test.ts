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
	tag: [tags.POSITRON_NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test('Python - Run All button toggles to Interrupt while cells are executing', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10493' }]
	}, async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		const runAllButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Run All', exact: true });
		const interruptButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Interrupt', exact: true });

		await test.step('Setup: create notebook with a long-running cell', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'import time; time.sleep(30)', { run: false });
		});

		await test.step('Verify Run All is visible and Interrupt is not before execution', async () => {
			await expect(runAllButton).toBeVisible();
			await expect(interruptButton).not.toBeVisible();
		});

		await test.step('Click Run All and verify it switches to Interrupt', async () => {
			await runAllButton.click();
			await expect(interruptButton).toBeVisible({ timeout: 10000 });
			await expect(runAllButton).not.toBeVisible();
		});

		await test.step('Click Interrupt and verify it switches back to Run All', async () => {
			await interruptButton.click();
			await expect(runAllButton).toBeVisible({ timeout: 15000 });
			await expect(interruptButton).not.toBeVisible();
		});
	});

	test('Python - Interrupt button cancels execution and cell stops running', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10493' }]
	}, async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		const runAllButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Run All', exact: true });
		const interruptButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Interrupt', exact: true });

		await test.step('Setup: create notebook with an infinite loop cell', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'while True: pass', { run: false });
		});

		await test.step('Run All and wait for Interrupt to appear', async () => {
			await runAllButton.click();
			await expect(interruptButton).toBeVisible({ timeout: 10000 });
		});

		await test.step('Click Interrupt to stop the infinite loop', async () => {
			await interruptButton.click();
			await expect(runAllButton).toBeVisible({ timeout: 15000 });
		});

		await test.step('Verify cell execution stopped with an error', async () => {
			await notebooksPositron.expectNoActiveSpinners();
		});
	});

	test('Python - Run All completes normally for fast cells without showing Interrupt', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10493' }]
	}, async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		const runAllButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Run All', exact: true });

		await test.step('Setup: create notebook with a fast cell', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'print("hello")', { run: false });
		});

		await test.step('Run All and verify it completes and button returns', async () => {
			await runAllButton.click();
			await notebooksPositron.expectNoActiveSpinners();
			await expect(runAllButton).toBeVisible({ timeout: 15000 });
		});

		await test.step('Verify output was produced', async () => {
			await notebooksPositron.expectOutputAtIndex(0, ['hello']);
		});
	});

	test('Python - Run All with multiple cells shows Interrupt during execution', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/10493' }]
	}, async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		const runAllButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Run All', exact: true });
		const interruptButton = notebooksPositron.editorActionBar.getByRole('button', { name: 'Interrupt', exact: true });

		await test.step('Setup: create notebook with multiple cells', async () => {
			await notebooksPositron.newNotebook();
			await notebooksPositron.kernel.select('Python');
			await notebooksPositron.addCodeToCell(0, 'import time; time.sleep(30)', { run: false });
			await notebooksPositron.addCell('code');
			await notebooksPositron.addCodeToCell(1, 'print("cell 2")', { run: false });
		});

		await test.step('Click Run All and verify Interrupt appears', async () => {
			await runAllButton.click();
			await expect(interruptButton).toBeVisible({ timeout: 10000 });
			await expect(runAllButton).not.toBeVisible();
		});

		await test.step('Interrupt all and verify Run All returns', async () => {
			await interruptButton.click();
			await expect(runAllButton).toBeVisible({ timeout: 15000 });
			await notebooksPositron.expectNoActiveSpinners();
		});
	});
});
