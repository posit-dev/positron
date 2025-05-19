/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({ suiteId: __filename });

test.describe('R Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async ({ executeCode }) => {
		await executeCode('R', `dat <- data.frame(
			blackberry = c(4, 9, 6),
			blueberry = c(1, 2, 8),
			peach = c(59, 150, 10),
			plum = c(30, 78, 5)
		)
		rownames(dat) <- c("calories", "weight", "yumminess")`);
	});

	test.afterEach(async ({ hotKeys, app }) => {
		await hotKeys.closeAllEditors();
		await app.workbench.console.clearButton.click();
	});

	test('R - Verify debugging with `browser()` via console', async ({ page, openFile, runCommand, executeCode }) => {
		await loadAndTriggerBreakpoint(openFile, runCommand, executeCode);
		await verifyDebugState(page);

		// Inspect variables manually via console input
		await inspectConsoleVariable(page, 'pattern', '[1] "berry"');
		await inspectConsoleVariable(page, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

		// Step into the next line using 's'
		await page.keyboard.type('s');
		await page.keyboard.press('Enter');
		await expect(page.getByText(/debug at .*#3: cols <- grep\(pattern, names\(dat\)\)/)).toBeVisible();

		// Step over to next line using 'n'
		await page.keyboard.type('n');
		await page.keyboard.press('Enter');
		await expect(page.getByText(/debug at .*#4: mini_dat <- dat\[, cols\]/)).toBeVisible();

		// Continue execution with 'c'
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');
		await expect(page.getByText('Found 2 fruits!')).toBeVisible();
	});

	test('R - Verify debugging with `browser()` via debugging UI tools', async ({ app, page, openFile, runCommand, executeCode }) => {
		const { debug } = app.workbench;

		await loadAndTriggerBreakpoint(openFile, runCommand, executeCode);
		await verifyDebugState(page);

		// Evaluate values in the console to confirm correct inputs
		await inspectConsoleVariable(page, 'pattern', '[1] "berry"');
		await inspectConsoleVariable(page, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

		// Step into and over using debugger UI controls
		await debug.stepInto();
		await expect(page.getByText(/debug at .*#3: cols <- grep\(pattern, names\(dat\)\)/)).toBeVisible();

		await debug.stepOver();
		await expect(page.getByText(/debug at .*#4: mini_dat <- dat\[, cols\]/)).toBeVisible();

		// Continue execution and check final message
		await debug.continue();
		await expect(page.getByText('Found 2 fruits!')).toBeVisible();
	});

	test('R - Verify debugging with `debugonce()` pauses only once', async ({ page, executeCode, openFile, runCommand }) => {
		await openFile('workspaces/r-debugging/fruit_avg.r');
		await runCommand('r.sourceCurrentFile');

		await executeCode('R', 'debugonce(fruit_avg)');
		await executeCode('R', 'fruit_avg(dat, "berry")', { waitForReady: false });

		// First call should pause at debug prompt
		await expect(page.getByText('Browse[1]>')).toBeVisible();

		// Continue execution
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');
		await expect(page.getByText('Found 2 fruits!')).toBeVisible();

		// Call again — should not pause this time
		await executeCode('R', 'fruit_avg(dat, "berry")', { waitForReady: false });
		await expect(page.getByText('Found 2 fruits!')).toHaveCount(2);
	});

	test('R - Verify debugging with `options(error = recover)` interactive recovery mode', async ({ app, page, openFile, runCommand, executeCode }) => {
		await openFile('workspaces/r-debugging/fruit_avg.r');
		await runCommand('r.sourceCurrentFile');

		// Enable recovery mode so errors trigger the interactive debugger
		await executeCode('R', 'options(error = recover)');

		// This should throw an error inside rowMeans(mini_dat)
		await executeCode('R', 'fruit_avg(dat, "black")', { waitForReady: false });

		// Confirm recovery prompt appears and frame selection is offered
		await expect(page.getByText('Enter a frame number, or 0 to exit')).toBeVisible();
		await expect(page.getByText('1: fruit_avg(dat, "black")')).toBeVisible();

		// Select the inner function frame to inspect local variables
		await expect(page.getByText('Selection:')).toBeVisible();
		await page.keyboard.type('1');
		await page.keyboard.press('Enter');

		// Confirm error message appears in sidebar
		await expect(page.locator('.activity-error-message'))
			.toContainText("'x' must be an array of at least two dimensions");

		// Check the contents of mini_dat (only one column matched)
		await app.workbench.console.focus();
		await inspectConsoleVariable(page, 'mini_dat', '[1] 4 9 6');

		// Quit the debugger and confirm REPL is ready
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await app.workbench.console.waitForReady('>');
	});
});


// Helper: validate debugger is paused and expected UI panels are visible
async function verifyDebugState(page) {
	await expect(page.getByText('Browse[1]>')).toBeVisible();

	await expect(page.getByRole('button', { name: 'Debug Variables Section' })).toBeVisible();
	await expect(page.getByLabel('pattern, value "berry"')).toBeVisible();
	await expect(page.getByLabel('dat, value dat')).toBeVisible();

	await expect(page.getByRole('button', { name: 'Call Stack Section' })).toBeVisible();
	const debugCallStack = page.locator('.debug-call-stack');
	await expect(debugCallStack.getByText('fruit_avg()fruit_avg()2:')).toBeVisible();
	await expect(debugCallStack.getByText('<global>fruit_avg(dat, "berry")')).toBeVisible();
}

// Helper: evaluate variable in console and validate the result
async function inspectConsoleVariable(page, name: string, expectedText: string) {
	await page.keyboard.type(name);
	await page.keyboard.press('Enter');
	await expect(page.getByText(expectedText)).toBeVisible({ timeout: 30000 });
}

// Helper: open R script, source it, and run function call to trigger browser()
async function loadAndTriggerBreakpoint(openFile, runCommand, executeCode, file = 'fruit_avg_browser.r', pattern = 'berry') {
	await openFile(`workspaces/r-debugging/${file}`);
	await runCommand('r.sourceCurrentFile');
	await executeCode('R', `fruit_avg(dat, "${pattern}")`, { waitForReady: false });
}
