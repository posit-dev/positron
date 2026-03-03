/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Static Content', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ r, settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Verify markdown image preview appears below image declaration', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'images_and_equations.qmd'));
		await editors.waitForActiveTab('images_and_equations.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();


		// Wait for image preview
		await editors.clickTab('images_and_equations.qmd');
		await quartoInlineOutput.gotoLine(10);
		await expect(quartoInlineOutput.imagePreviewWrapper.first()).toBeVisible({ timeout: 1000 });

		// Verify specific image
		const mandelbrotImage = app.code.driver.page.locator('.quarto-image-preview[alt="The Mandlebrot Set"]');
		await expect(mandelbrotImage).toBeVisible({ timeout: 10000 });

		// Verify image has data URL src
		const imgSrc = await mandelbrotImage.getAttribute('src');
		expect(imgSrc).toBeTruthy();
		expect(imgSrc).toMatch(/^data:image\/jpeg;base64,/);

		// Verify preview container
		const previewContainer = app.code.driver.page.locator('.quarto-image-preview-container').first();
		await expect(previewContainer).toBeVisible({ timeout: 5000 });
	});

	test('Verify missing image shows error message in preview', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'images_and_equations.qmd'));
		await editors.waitForActiveTab('images_and_equations.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Wait for error preview
		await editors.clickTab('images_and_equations.qmd');
		await quartoInlineOutput.gotoLine(20);
		await expect(quartoInlineOutput.imagePreviewError).toHaveCount(1, { timeout: 1000 });

		// Verify error message
		const errorText = app.code.driver.page.locator('.quarto-image-preview-error-text');
		await expect(errorText).toHaveCount(1, { timeout: 10000 });
		const errorContent = await errorText.textContent();
		expect(errorContent).toContain('julia.jpg');
		expect(errorContent).toContain('not found');

		await expect(quartoInlineOutput.imagePreviewError).toHaveCount(1, { timeout: 5000 });
	});

	test('Bash - Verify inline output appears after running a bash code cell', async function ({ app, openFile }) {
		const { editors, quartoInlineOutput } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'multiple_languages.qmd'));
		await editors.waitForActiveTab('multiple_languages.qmd');
		await quartoInlineOutput.expectKernelStatusVisible();

		// Position at bash cell and run via toolbar
		await editors.clickTab('multiple_languages.qmd');
		await quartoInlineOutput.gotoLine(28);
		await expect(quartoInlineOutput.cellToolbar.last()).toBeVisible({ timeout: 10000 });
		const runButton = quartoInlineOutput.cellToolbar.last().locator('.quarto-toolbar-run');
		await runButton.click();

		// Wait for output
		await quartoInlineOutput.gotoLine(35);
		await expect(quartoInlineOutput.inlineOutput.last()).toBeVisible();

		// Verify output content
		const outputContent = quartoInlineOutput.getOutputContentAt(-1); // last output
		await expect(quartoInlineOutput.inlineOutput.last().locator('.quarto-output-content')).toBeVisible({ timeout: 10000 });

		const outputText = await quartoInlineOutput.inlineOutput.last().locator('.quarto-output-content').textContent();
		expect(outputText).toBeTruthy();
		expect(outputText).toContain('Your home directory is');
		expect(outputText).not.toContain('echo');
		expect(outputText).not.toMatch(/^\s*\$/m);
	});
});
