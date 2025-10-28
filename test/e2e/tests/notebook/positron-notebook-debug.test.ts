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
 */

import { test, tags } from '../_test.setup.js';

test.use({ suiteId: __filename });

test.describe('Positron Notebook Debugging', {
	tag: [tags.WEB, tags.WIN, tags.DEBUG, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ app, settings }) {
		await app.workbench.notebooksPositron.enablePositronNotebooks(settings);
	});

	test.afterEach(async ({ hotKeys }) => {
		await hotKeys.closeAllEditors();
	});

	test('Python - Core debugging workflow: breakpoints, variable inspection, step controls, and output verification', async ({ app, logger }) => {
		const { notebooksPositron, debug } = app.workbench;

		await notebooksPositron.createNewNotebook();
		await notebooksPositron.kernel.select('Python');
		await notebooksPositron.addCodeToCell(0, pythonCode);

		// Set 2 breakpoints
		await debug.setBreakpointOnLine(5); // intermediate calculation
		await debug.setBreakpointOnLine(9); // string formatting

		// Start debugging
		await debug.debugCell();

		// Verify 1st breakpoint
		await debug.expectCurrentLineIndicatorVisible();
		await debug.expectVariablesToExist([
			{ label: 'x', value: '10' },
			{ label: 'y', value: '20' }
		]);

		// Step over to execute the intermediate calculation (BP1)
		await debug.stepOver();

		// Verify 2nd breakpoint
		await debug.continue();
		await debug.expectCurrentLineIndicatorVisible();
		await debug.expectVariablesToExist([
			{ label: 'x', value: '10' },
			{ label: 'y', value: '20' },
			{ label: 'intermediate', value: '20' }
		]);

		// Continue
		await debug.continue();

		// Verify final output
		await notebooksPositron.expectOutputAtIndex(0, ['Result from Positron: 40']);

		// Clean up BPs
		await debug.unSetBreakpointOnLine(5);
		await debug.unSetBreakpointOnLine(9);
	});
});

const pythonCode = [
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
