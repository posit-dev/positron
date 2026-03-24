/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Quarto - Inline Output: Cell Metadata', {
	tag: [tags.WEB, tags.WIN, tags.QUARTO]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.quarto.inlineOutput.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Cell options are passed as execution metadata', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open the cell metadata test fixture
		await openFile(join('workspaces', 'quarto_inline_output', 'cell_metadata.qmd'));
		await editors.waitForActiveTab('cell_metadata.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell containing #| fig-width: 4 and #| fig-height: 3
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 11 });

		// Get the output text (JSON from %_positron_exec_metadata magic)
		const outputText = await inlineQuarto.getOutputItemAt(0).textContent();
		expect(outputText).toBeTruthy();

		const metadata = JSON.parse(outputText!.trim());
		expect(metadata['fig-width']).toBe(4);
		expect(metadata['fig-height']).toBe(3);
	});

	test('Python - Inline output includes output_width_px and output_pixel_ratio in execution metadata', async function ({ python, app, openFile }) {
		const { editors, inlineQuarto } = app.workbench;

		// Open the cell metadata test fixture
		await openFile(join('workspaces', 'quarto_inline_output', 'cell_metadata.qmd'));
		await editors.waitForActiveTab('cell_metadata.qmd');
		await inlineQuarto.expectKernelStatusVisible();

		// Run the cell containing #| fig-width: 4 and #| fig-height: 3
		await inlineQuarto.runCellAndWaitForOutput({ cellLine: 8, outputLine: 11 });

		// Get the output text (JSON from %_positron_exec_metadata magic)
		const outputText = await inlineQuarto.getOutputItemAt(0).textContent();
		expect(outputText).toBeTruthy();

		const metadata = JSON.parse(outputText!.trim());

		// output_width_px should be present and have a reasonable nonzero value
		expect(metadata['output_width_px']).toBeDefined();
		expect(typeof metadata['output_width_px']).toBe('number');
		expect(metadata['output_width_px']).toBeGreaterThan(100);

		// output_pixel_ratio should be present and have a reasonable value (1.0 - 3.0)
		expect(metadata['output_pixel_ratio']).toBeDefined();
		expect(typeof metadata['output_pixel_ratio']).toBe('number');
		expect(metadata['output_pixel_ratio']).toBeGreaterThanOrEqual(1.0);
		expect(metadata['output_pixel_ratio']).toBeLessThanOrEqual(3.0);
	});
});
