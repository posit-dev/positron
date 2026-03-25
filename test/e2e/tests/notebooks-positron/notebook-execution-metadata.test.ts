/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Execution Metadata', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test('Python - Positron notebook cells include output_width_px and output_pixel_ratio in execution metadata', async function ({ app, python }) {
		const { notebooksPositron } = app.workbench;

		await notebooksPositron.newNotebook();
		await notebooksPositron.kernel.select('Python');

		// Execute code that prints the execution metadata as JSON
		await notebooksPositron.addCodeToCell(0, '%_positron_exec_metadata', { run: true });

		// Wait for output and get its text content
		const cellOutput = app.workbench.notebooksPositron.cell.nth(0).getByTestId('cell-output');
		await expect(cellOutput).toBeVisible({ timeout: 30000 });
		const outputText = await cellOutput.textContent();
		expect(outputText).toBeTruthy();

		// Parse the JSON output
		const metadata = JSON.parse(outputText!.trim());

		// output_width_px should be present and have a reasonable nonzero value
		expect(metadata['output_width_px']).toBeDefined();
		expect(typeof metadata['output_width_px']).toBe('number');
		expect(metadata['output_width_px']).toBeGreaterThan(100);

		// output_pixel_ratio should be present and have a reasonable value (~1.0 - 3.0)
		// Use 0.99 lower bound to allow for floating-point precision drift
		expect(metadata['output_pixel_ratio']).toBeDefined();
		expect(typeof metadata['output_pixel_ratio']).toBe('number');
		expect(metadata['output_pixel_ratio']).toBeGreaterThanOrEqual(0.99);
		expect(metadata['output_pixel_ratio']).toBeLessThanOrEqual(3.0);
	});
});
