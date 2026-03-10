"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Quarto - Inline Output: Static Content', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.QUARTO]
}, () => {
    _test_setup_1.test.beforeAll(async function ({ r, settings }) {
        await settings.set({
            'positron.quarto.inlineOutput.enabled': true
        }, { reload: 'web' });
    });
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    (0, _test_setup_1.test)('Verify markdown image preview appears below image declaration', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'images_and_equations.qmd'));
        await editors.waitForActiveTab('images_and_equations.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Wait for image preview
        await editors.clickTab('images_and_equations.qmd');
        await inlineQuarto.gotoLine(10);
        await (0, _test_setup_1.expect)(inlineQuarto.imagePreviewWrapper.first()).toBeVisible({ timeout: 1000 });
        // Verify specific image
        const mandelbrotImage = app.code.driver.currentPage.locator('.quarto-image-preview[alt="The Mandlebrot Set"]');
        await (0, _test_setup_1.expect)(mandelbrotImage).toBeVisible({ timeout: 10000 });
        // Verify image has data URL src
        const imgSrc = await mandelbrotImage.getAttribute('src');
        (0, _test_setup_1.expect)(imgSrc).toBeTruthy();
        (0, _test_setup_1.expect)(imgSrc).toMatch(/^data:image\/jpeg;base64,/);
        // Verify preview container
        const previewContainer = app.code.driver.currentPage.locator('.quarto-image-preview-container').first();
        await (0, _test_setup_1.expect)(previewContainer).toBeVisible({ timeout: 5000 });
    });
    (0, _test_setup_1.test)('Verify missing image shows error message in preview', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'images_and_equations.qmd'));
        await editors.waitForActiveTab('images_and_equations.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Wait for error preview
        await editors.clickTab('images_and_equations.qmd');
        await inlineQuarto.gotoLine(20);
        await (0, _test_setup_1.expect)(inlineQuarto.imagePreviewError).toHaveCount(1, { timeout: 1000 });
        // Verify error message
        const errorText = app.code.driver.currentPage.locator('.quarto-image-preview-error-text');
        await (0, _test_setup_1.expect)(errorText).toHaveCount(1, { timeout: 10000 });
        const errorContent = await errorText.textContent();
        (0, _test_setup_1.expect)(errorContent).toContain('julia.jpg');
        (0, _test_setup_1.expect)(errorContent).toContain('not found');
        await (0, _test_setup_1.expect)(inlineQuarto.imagePreviewError).toHaveCount(1, { timeout: 5000 });
    });
    (0, _test_setup_1.test)('Bash - Verify inline output appears after running a bash code cell', async function ({ app, openFile }) {
        const { editors, inlineQuarto } = app.workbench;
        // Open a Quarto file and wait for the kernel to be ready
        await openFile((0, path_1.join)('workspaces', 'quarto_inline_output', 'multiple_languages.qmd'));
        await editors.waitForActiveTab('multiple_languages.qmd');
        await inlineQuarto.expectKernelStatusVisible();
        // Position at bash cell and run via toolbar
        await editors.clickTab('multiple_languages.qmd');
        await inlineQuarto.gotoLine(28);
        await (0, _test_setup_1.expect)(inlineQuarto.cellToolbar.last()).toBeVisible({ timeout: 10000 });
        const runButton = inlineQuarto.cellToolbar.last().locator('.quarto-toolbar-run');
        await runButton.click();
        // Wait for output
        await inlineQuarto.gotoLine(35);
        await (0, _test_setup_1.expect)(inlineQuarto.inlineOutput.last()).toBeVisible();
        // Verify output content
        await (0, _test_setup_1.expect)(inlineQuarto.inlineOutput.last().locator('.quarto-output-content')).toBeVisible({ timeout: 10000 });
        const outputText = await inlineQuarto.inlineOutput.last().locator('.quarto-output-content').textContent();
        (0, _test_setup_1.expect)(outputText).toBeTruthy();
        (0, _test_setup_1.expect)(outputText).toContain('Your home directory is');
        (0, _test_setup_1.expect)(outputText).not.toContain('echo');
        (0, _test_setup_1.expect)(outputText).not.toMatch(/^\s*\$/m);
    });
});
//# sourceMappingURL=quarto-inline-output-static.test.js.map