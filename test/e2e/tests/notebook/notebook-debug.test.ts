/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Notebook Debugging E2E Test
 *
 * This test focuses on the core user experience for debugging notebooks:
 * - Setting breakpoints in notebook cells
 * - Inspecting variables at breakpoints
 * - Using step controls (step over)
 * - Continuing execution
 * - Verifying final output
 *
 * This single comprehensive test validates the essential debugging workflow
 * that users rely on, while keeping the e2e suite more lean and maintainable.
 *
 * Additional debugging scenarios (different data types, edge cases, etc.)
 * should be covered by faster unit/integration tests.
 */


import { Application } from '../../infra/application.js';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({ suiteId: __filename });

test.describe('Notebook Debugging', {
	tag: [tags.DEBUG, tags.NOTEBOOKS, tags.WEB, tags.WIN]
}, () => {

	test.beforeEach(async ({ app }) => {
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooks.selectInterpreter('Python');
	});

	test.afterEach(async ({ app }) => {
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

	// Single, simpler test that covers it all basics, instead of many separate and redundant tests.
	test('Python - Core debugging workflow: breakpoints, variable inspection, step controls, and output verification', async ({ app, logger }) => {
		const code = [
			'# Initialize variables',
			'x = 10',
			'y = 20',
			'# Perform calculations with breakpoint here',
			'intermediate = x * 2',  // BP1
			'result = intermediate + y',
			'# String operations',
			'name = "Positron"',
			'message = f"Result from {name}: {result}"',  // BP2
			'# Final output',
			'print(message)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(0, code);

		// Set BPs
		await app.workbench.debug.setBreakpointOnLine(5); // intermediate calculation
		await app.workbench.debug.setBreakpointOnLine(9); // string formatting

		// Start debugging
		await debugNotebook(app);

		// BP1
		await app.workbench.debug.expectCurrentLineIndicatorVisible();
		const vars1 = await app.workbench.debug.getVariables();
		logger.log('Variables at first breakpoint:', vars1);

		// Step over to execute the intermediate calculation (BP1)
		await app.workbench.debug.stepOver();
		await app.code.wait(1000);

		// Continue to next BP
		await app.workbench.debug.continue();
		await app.workbench.debug.expectCurrentLineIndicatorVisible();

		// BP2
		const vars2 = await app.workbench.debug.getVariables();
		logger.log('Variables at second breakpoint:', vars2);

		// Continue
		await app.workbench.debug.continue();
		await app.code.wait(3000);

		// Verify final output
		await expect(app.workbench.notebooks.frameLocator.locator('text=Result from Positron: 40')).toBeVisible();

		// Clean up BPs
		await app.workbench.debug.unSetBreakpointOnLine(5);
		await app.workbench.debug.unSetBreakpointOnLine(9);
	});
});

async function debugNotebook(app: Application): Promise<void> {
	await test.step('Debug notebook', async () => {
		await expect(app.code.driver.page.locator('.positron-variables-container').locator('text=No Variables have been created')).toBeVisible();
		await app.workbench.quickaccess.runCommand('notebook.debugCell');
		await app.workbench.debug.expectCurrentLineIndicatorVisible();
	});
}
