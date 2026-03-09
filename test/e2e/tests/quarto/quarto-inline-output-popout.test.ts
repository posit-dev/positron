/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import * as fs from 'fs';
import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Popout', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ python, settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.afterAll(async function ({ cleanup }) {
		await cleanup.discardAllChanges();
	});

	test('Python - Verify save button saves plot to file', async function ({ app, openFile, page }) {
		const { editors, inlineQuarto, quickInput, toasts } = app.workbench;

		// Set up a unique file name for the saved plot to avoid conflicts
		const savedPlotName = `test-plot-${Date.now()}.png`;
		const savedPlotPath = join(app.workspacePathOrFolder, savedPlotName);

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });

		// Save the plot
		await inlineQuarto.gotoLine(19);
		await inlineQuarto.saveButton.click();
		await quickInput.waitForQuickInputOpened();
		await quickInput.type(savedPlotPath);
		await quickInput.clickOkButton();
		await toasts.expectToastWithTitle('.png saved');

		// Verify file was created
		expect(fs.existsSync(savedPlotPath)).toBe(true);
		const stats = fs.statSync(savedPlotPath);
		expect(stats.size).toBeGreaterThan(100);

		// Verify PNG magic bytes
		const fileBuffer = fs.readFileSync(savedPlotPath);
		expect(fileBuffer[0]).toBe(137);
		expect(fileBuffer[1]).toBe(80);
	});

	test('Python - Verify popout button appears for plot output and opens image in new tab',
		{
			annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/12373' }]
		},
		async function ({ app, openFile }) {
			const { editors, inlineQuarto } = app.workbench;

			// Open a Quarto file and wait for the kernel to be ready
			await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
			await editors.waitForActiveTab('simple_plot.qmd');
			await inlineQuarto.expectKernelStatusVisible();

			// Run the cell and wait for output
			await editors.clickTab('simple_plot.qmd');
			await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
			await inlineQuarto.expectOutputVisible();

			// Verify new tab opens with image when popout button is clicked
			await inlineQuarto.gotoLine(19);
			await inlineQuarto.popoutOutput();
			await editors.verifyTab('simple_plot.qmd', { isVisible: true, isSelected: false });
			await editors.verifyTab('.positron-temp-simple_plot_cell0.png', { isVisible: true, isSelected: true });
		});

	test('Python - Verify popout command opens text output in new editor', async function ({ app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;
		const tab1 = 'text_output.qmd';
		const tab2 = 'Hello World from Quarto inline output te';

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'text_output.qmd'));
		await editors.waitForActiveTab(tab1);
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab(tab1);
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 13, outputLine: 20 });

		// Verify new tab opens with text output when popout command is run
		await inlineQuarto.gotoLine(13);
		await inlineQuarto.runPopoutCommand();
		await editors.verifyTab(tab1, { isVisible: true, isSelected: false });
		await editors.verifyTab(tab2, { isVisible: true, isSelected: true });
	});

	test('Python - Verify popout button is hidden for error-only output', async function ({ app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'r_errors.qmd'));
		await editors.waitForActiveTab('r_errors.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('r_errors.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });

		// Verify error is visible and popout button is hidden
		await inlineQuarto.expectErrorCount(1);
		await expect(inlineQuarto.popoutButton).not.toBeVisible({ timeout: 5000 });
	});

	test.skip('Python - Verify popout button opens interactive HTML in viewer panel', async function ({ app, openFile }) {
		const { editors, inlineQuarto, viewer, toasts } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'interactive_plot.qmd'));
		await editors.waitForActiveTab('interactive_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('interactive_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await inlineQuarto.expectOutputVisible();

		// Run the popout command and verify viewer panel opens with interactive HTML
		await inlineQuarto.gotoLine(8);
		await inlineQuarto.runPopoutCommand();
		await viewer.expectViewerPanelVisible();
		await toasts.expectToastWithTitleNotToAppear('Failed to open');
	});

	test('Python - Verify Open Output in New Tab command works', async function ({ app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'simple_plot.qmd'));
		await editors.waitForActiveTab('simple_plot.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('simple_plot.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 12, outputLine: 25 });
		await inlineQuarto.expectOutputVisible();

		// Run the popout command and verify new tab opens with image
		await inlineQuarto.gotoLine(19);
		await inlineQuarto.runPopoutCommand();
		await editors.verifyTab('simple_plot.qmd', { isVisible: true, isSelected: false });
		await editors.verifyTab('.positron-temp-simple_plot_cell0.png', { isVisible: true, isSelected: true });
	});

	test('Python - Verify HTML popout displays DataFrame in viewer without errors', async function ({ app, openFile }) {
		const { editors, inlineQuarto, viewer, toasts } = app.workbench;

		// Open a Quarto file and wait for the kernel to be ready
		await openFile(join('workspaces', 'quarto_inline_output', 'py_data_frame.qmd'));
		await editors.waitForActiveTab('py_data_frame.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell and wait for output
		await editors.clickTab('py_data_frame.qmd');
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 15 });
		await inlineQuarto.expectOutputVisible();

		// Run the popout command and verify viewer panel opens with DataFrame HTML
		await inlineQuarto.popoutOutput();
		await viewer.expectViewerPanelVisible();

		// Verify DataFrame content in viewer
		const previewIframe = viewer.getViewerFrame().frameLocator('#preview-iframe');
		await expect(async () => {
			const body = previewIframe.locator('body');
			await expect(body).toBeAttached({ timeout: 2000 });
			const text = await body.textContent({ timeout: 2000 });
			expect(text).toContain('Alice');
		}).toPass({ timeout: 30000 });

		const body = previewIframe.locator('body');
		const bodyText = await body.textContent();
		expect(bodyText).not.toContain('Cannot GET');

		await toasts.expectToastWithTitleNotToAppear('Failed to open');
	});
});
