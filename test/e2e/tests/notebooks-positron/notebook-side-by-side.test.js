"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Notebook Side-by-Side Isolation Tests
 *
 * Verifies that when two notebooks are open side-by-side:
 * 1. Kernel selection and status are independent per notebook
 * 2. The "Run All" button executes cells in its own notebook, not the focused one
 */
const _test_setup_1 = require("../_test.setup");
const _test_setup_js_1 = require("./_test.setup.js");
const sessions_js_1 = require("../../pages/sessions.js");
_test_setup_js_1.test.use({
    suiteId: __filename
});
_test_setup_js_1.test.describe('Notebook Side-by-Side Isolation', {
    tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.WEB, _test_setup_1.tags.POSITRON_NOTEBOOKS]
}, () => {
    (0, _test_setup_js_1.test)('Kernel status is independent per notebook when side-by-side', async function ({ app, page }) {
        const { notebooksPositron } = app.workbench;
        const pythonVersion = process.env.POSITRON_PY_VER_SEL;
        // Create first notebook and select Python kernel while it is the only visible notebook.
        // POM locators are page-scoped, so they work correctly with a single notebook.
        await _test_setup_js_1.test.step('Create notebook 1 and select Python kernel', async () => {
            await notebooksPositron.newNotebook();
            await notebooksPositron.kernel.select('Python');
        });
        // Create second notebook (opens as a new tab, hiding notebook 1).
        // Do NOT select a kernel for this notebook.
        await _test_setup_js_1.test.step('Create notebook 2 (no kernel)', async () => {
            await notebooksPositron.newNotebook();
        });
        // Move notebook 2 to a side editor group so both are visible.
        // After this, notebook 2 (right) is focused, notebook 1 (left) is unfocused.
        await _test_setup_js_1.test.step('Split notebooks side-by-side', async () => {
            await app.workbench.quickaccess.runCommand('workbench.action.moveEditorToNextGroup');
        });
        // Use scoped locators to verify each editor group independently.
        // Page-level POM locators would match elements in both groups, so we scope
        // to each .editor-group-container to test per-notebook behavior.
        const editorGroups = page.locator('.part.editor .editor-group-container');
        await (0, _test_setup_1.expect)(editorGroups).toHaveCount(2, { timeout: 5000 });
        // Left group = notebook 1 (Python kernel selected)
        // Right group = notebook 2 (no kernel selected)
        const leftGroup = editorGroups.nth(0);
        const rightGroup = editorGroups.nth(1);
        await _test_setup_js_1.test.step('Verify left notebook (nb1) shows Python kernel', async () => {
            const leftKernelBadge = leftGroup.getByRole('button', { name: 'Kernel Actions' });
            await (0, _test_setup_1.expect)(leftKernelBadge).toContainText(pythonVersion, { timeout: 15000 });
            await (0, _test_setup_1.expect)(leftGroup.locator('.editor-action-bar-container').locator(sessions_js_1.IDLE_STATUS_ICON)).toBeVisible({ timeout: 15000 });
        });
        await _test_setup_js_1.test.step('Verify right notebook (nb2) does NOT show Python kernel', async () => {
            const rightKernelBadge = rightGroup.getByRole('button', { name: 'Kernel Actions' });
            await (0, _test_setup_1.expect)(rightKernelBadge).not.toContainText(pythonVersion, { timeout: 5000 });
        });
    });
    (0, _test_setup_js_1.test)('Run All button executes cells in its own notebook, not the focused one', async function ({ app, page }) {
        const { notebooksPositron } = app.workbench;
        // Set up notebook 1 with Python code while it is the only visible notebook.
        await _test_setup_js_1.test.step('Create notebook 1 with Python code', async () => {
            await notebooksPositron.newNotebook();
            await notebooksPositron.kernel.select('Python');
            await notebooksPositron.addCodeToCell(0, 'print("from_nb1")');
        });
        // Set up notebook 2 with different Python code (opens as tab, nb1 hidden).
        await _test_setup_js_1.test.step('Create notebook 2 with Python code', async () => {
            await notebooksPositron.newNotebook();
            await notebooksPositron.kernel.select('Python');
            await notebooksPositron.addCodeToCell(0, 'print("from_nb2")');
        });
        // Move notebook 2 to a side editor group.
        // After: nb1 (left, unfocused), nb2 (right, focused).
        await _test_setup_js_1.test.step('Split notebooks side-by-side', async () => {
            await app.workbench.quickaccess.runCommand('workbench.action.moveEditorToNextGroup');
        });
        const editorGroups = page.locator('.part.editor .editor-group-container');
        await (0, _test_setup_1.expect)(editorGroups).toHaveCount(2, { timeout: 5000 });
        const leftGroup = editorGroups.nth(0);
        const rightGroup = editorGroups.nth(1);
        // Focus the LEFT notebook (nb1) by clicking on its cell.
        // This makes nb1 the "active" editor while nb2 is visible but unfocused.
        await _test_setup_js_1.test.step('Focus left notebook (nb1)', async () => {
            await leftGroup.locator('[data-testid="notebook-cell"]').first().click();
        });
        // Click "Run All" in the RIGHT notebook's (nb2) editor action bar.
        await _test_setup_js_1.test.step('Click Run All in right notebook action bar', async () => {
            const rightRunAll = rightGroup.locator('.editor-action-bar-container')
                .getByRole('button', { name: 'Run All' });
            await rightRunAll.click();
        });
        // Verify RIGHT notebook (nb2) cells have the expected output.
        // If Run All targeted the correct notebook, nb2's cell should show "from_nb2".
        await _test_setup_js_1.test.step('Verify right notebook (nb2) has output from its own code', async () => {
            const rightCellOutput = rightGroup.locator('[data-testid="cell-output"]');
            await (0, _test_setup_1.expect)(rightCellOutput).toContainText('from_nb2', { timeout: 30000 });
        });
        // Verify LEFT notebook (nb1) was NOT executed.
        // If Run All incorrectly targeted the focused editor, nb1 would have output.
        await _test_setup_js_1.test.step('Verify left notebook (nb1) was NOT executed', async () => {
            const leftCellOutput = leftGroup.locator('[data-testid="cell-output"]');
            await (0, _test_setup_1.expect)(leftCellOutput).not.toBeVisible({ timeout: 5000 });
        });
    });
});
//# sourceMappingURL=notebook-side-by-side.test.js.map