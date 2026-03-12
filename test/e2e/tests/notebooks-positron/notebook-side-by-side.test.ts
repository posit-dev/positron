/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Notebook Side-by-Side Isolation Tests
 *
 * Verifies that when two notebooks are open side-by-side:
 * 1. Kernel selection and status are independent per notebook
 * 2. The "Run All" button executes cells in its own notebook, not the focused one
 *
 * BUG: These tests are expected to FAIL, demonstrating that kernel status is
 * shared across notebooks and Run All targets the focused editor.
 */

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';
import { IDLE_STATUS_ICON } from '../../pages/sessions.js';

test.use({
	suiteId: __filename
});

test.describe('Notebook Side-by-Side Isolation', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test('Kernel status is independent per notebook when side-by-side',
		{
			annotation: [{ type: 'bug', description: 'Kernel selection and status is shared across side-by-side notebooks' }]
		},
		async function ({ app, page }) {
			const { notebooksPositron } = app.workbench;
			const pythonVersion = process.env.POSITRON_PY_VER_SEL!;

			// Create first notebook and select Python kernel while it is the only visible notebook.
			// POM locators are page-scoped, so they work correctly with a single notebook.
			await test.step('Create notebook 1 and select Python kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			// Create second notebook (opens as a new tab, hiding notebook 1).
			// Do NOT select a kernel for this notebook.
			await test.step('Create notebook 2 (no kernel)', async () => {
				await notebooksPositron.newNotebook();
			});

			// Move notebook 2 to a side editor group so both are visible.
			// After this, notebook 2 (right) is focused, notebook 1 (left) is unfocused.
			await test.step('Split notebooks side-by-side', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.moveEditorToNextGroup');
			});

			// Use scoped locators to verify each editor group independently.
			// Page-level POM locators would match elements in both groups, so we scope
			// to each .editor-group-container to test per-notebook behavior.
			const editorGroups = page.locator('.part.editor .editor-group-container');
			await expect(editorGroups).toHaveCount(2, { timeout: 5000 });

			// Left group = notebook 1 (Python kernel selected)
			// Right group = notebook 2 (no kernel selected)
			const leftGroup = editorGroups.nth(0);
			const rightGroup = editorGroups.nth(1);

			await test.step('Verify left notebook (nb1) shows Python kernel', async () => {
				const leftKernelBadge = leftGroup.getByRole('button', { name: 'Kernel Actions' });
				await expect(leftKernelBadge).toContainText(pythonVersion, { timeout: 15000 });
				await expect(leftGroup.locator('.editor-action-bar-container').locator(IDLE_STATUS_ICON)).toBeVisible({ timeout: 15000 });
			});

			// BUG: Kernel status is shared across notebooks. The right notebook
			// (which has no kernel selected) incorrectly shows the Python kernel
			// from the left notebook.
			await test.step('Verify right notebook (nb2) does NOT show Python kernel', async () => {
				const rightKernelBadge = rightGroup.getByRole('button', { name: 'Kernel Actions' });
				await expect(rightKernelBadge).not.toContainText(pythonVersion, { timeout: 5000 });
			});
		});

	test('Run All button executes cells in its own notebook, not the focused one',
		{
			annotation: [{ type: 'bug', description: 'Run All button is scoped to the focused editor, not the editor it is rendered in' }]
		},
		async function ({ app, page }) {
			const { notebooksPositron } = app.workbench;

			// Set up notebook 1 with Python code while it is the only visible notebook.
			await test.step('Create notebook 1 with Python code', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
				await notebooksPositron.addCodeToCell(0, 'print("from_nb1")');
			});

			// Set up notebook 2 with different Python code (opens as tab, nb1 hidden).
			await test.step('Create notebook 2 with Python code', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
				await notebooksPositron.addCodeToCell(0, 'print("from_nb2")');
			});

			// Move notebook 2 to a side editor group.
			// After: nb1 (left, unfocused), nb2 (right, focused).
			await test.step('Split notebooks side-by-side', async () => {
				await app.workbench.quickaccess.runCommand('workbench.action.moveEditorToNextGroup');
			});

			const editorGroups = page.locator('.part.editor .editor-group-container');
			await expect(editorGroups).toHaveCount(2, { timeout: 5000 });
			const leftGroup = editorGroups.nth(0);
			const rightGroup = editorGroups.nth(1);

			// Focus the LEFT notebook (nb1) by clicking on its cell.
			// This makes nb1 the "active" editor while nb2 is visible but unfocused.
			await test.step('Focus left notebook (nb1)', async () => {
				await leftGroup.locator('[data-testid="notebook-cell"]').first().click();
			});

			// Click "Run All" in the RIGHT notebook's (nb2) editor action bar.
			// BUG: This executes cells in the focused (left) notebook instead of
			// the right notebook where the button lives.
			await test.step('Click Run All in right notebook action bar', async () => {
				const rightRunAll = rightGroup.locator('.editor-action-bar-container')
					.getByRole('button', { name: 'Run All' });
				await rightRunAll.click();
			});

			// Verify RIGHT notebook (nb2) cells have the expected output.
			// If Run All targeted the correct notebook, nb2's cell should show "from_nb2".
			await test.step('Verify right notebook (nb2) has output from its own code', async () => {
				const rightCellOutput = rightGroup.locator('[data-testid="cell-output"]');
				await expect(rightCellOutput).toContainText('from_nb2', { timeout: 30000 });
			});

			// Verify LEFT notebook (nb1) was NOT executed.
			// If Run All incorrectly targeted the focused editor, nb1 would have output.
			await test.step('Verify left notebook (nb1) was NOT executed', async () => {
				const leftCellOutput = leftGroup.locator('[data-testid="cell-output"]');
				await expect(leftCellOutput).not.toBeVisible({ timeout: 5000 });
			});
		});
});
