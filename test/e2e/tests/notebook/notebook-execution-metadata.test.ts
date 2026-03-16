/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebooks: Execution Metadata', {
	tag: [tags.NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Python - Notebook cells include output_width_px and output_pixel_ratio in execution metadata', async function ({ app, python }) {
		const { notebooks } = app.workbench;

		await notebooks.createNewNotebook();
		await notebooks.selectInterpreter('Python');

		// Type code that prints the execution metadata as JSON
		await notebooks.addCodeToCellAtIndex(0, '%_positron_exec_metadata');
		await notebooks.executeCodeInCell();

		// Get the output text from the first cell output
		const outputContainer = notebooks.frameLocator.locator('.output_container').nth(0);
		await expect(outputContainer).toBeVisible({ timeout: 30000 });
		const outputText = await outputContainer.textContent();
		expect(outputText).toBeTruthy();

		// Parse the JSON output
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
