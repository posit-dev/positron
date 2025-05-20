/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * R Debugging Feature
 *
 * This feature supports multiple debugging mechanisms for R-based code:
 * - Browser-based debugging with `browser()` and `debugonce()`
 * - Error recovery with `options(error = recover)`
 * - Full integration with Positron's debugging UI, call stack, and variables view
 *
 * Debugging flow:
 * 1. User sets breakpoints using R's native debugging functions (`browser()`, `debugonce()`, etc.)
 * 2. When execution reaches these points, Positron enters debug mode
 * 3. User can inspect variables, step through code, and control execution flow
 * 4. Debugging can be controlled via console commands (s/n/c/Q) or Positron's debugging UI
 * 5. Variables can be inspected in the console or in the Variables debugging pane
 */

import { Page } from '@playwright/test';
import { Application, SessionMetaData } from '../../infra/index.js';
import { test, tags, expect } from '../_test.setup';

let session: SessionMetaData;

test.use({ suiteId: __filename });

test.describe('R Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll('Setup fruit data', async ({ executeCode, sessions }) => {
		session = await sessions.start('r');
		await executeCode('R', `dat <- data.frame(
			blackberry = c(4, 9, 6),
			blueberry = c(1, 2, 8),
			peach = c(59, 150, 10),
			plum = c(30, 78, 5)
		)
		rownames(dat) <- c("calories", "weight", "yumminess")`);
	});

	test.afterEach('Reset for next test', async ({ hotKeys, app }) => {
		await hotKeys.closeAllEditors();
		await app.workbench.console.clearButton.click();
	});

	test('R - Verify debugging with `browser()` via console', async ({ app, page, openFile, runCommand, executeCode }) => {
		const { debug, console } = app.workbench;

		await openFile(`workspaces/r-debugging/fruit_avg_browser.r`);
		await runCommand('r.sourceCurrentFile');

		// Trigger the breakpoint
		await executeCode('R', `fruit_avg(dat, "berry")`, { waitForReady: false });
		await debug.expectBrowserModeFrame(1);

		// Verify the debug pane, call stack, and console variables
		await verifyDebugPane(app);
		await verifyCallStack(app);
		await verifyVariableInConsole(page, 'pattern', '[1] "berry"');
		await verifyVariableInConsole(page, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

		// Step into the next line using 's'
		await page.keyboard.type('s');
		await page.keyboard.press('Enter');
		await console.waitForConsoleContents(/debug at .*#3: cols <- grep\(pattern, names\(dat\)\)/);

		// Step over to next line using 'n'
		await page.keyboard.type('n');
		await page.keyboard.press('Enter');
		await console.waitForConsoleContents(/debug at .*#4: mini_dat <- dat\[, cols\]/);

		// Continue execution with 'c'
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');
		await console.waitForConsoleContents('Found 2 fruits!');
	});

	test('R - Verify debugging with `browser()` via debugging UI tools', async ({ app, page, openFile, runCommand, executeCode }) => {
		const { debug, console } = app.workbench;

		await openFile(`workspaces/r-debugging/fruit_avg_browser.r`);
		await runCommand('r.sourceCurrentFile');

		// Trigger the breakpoint
		await executeCode('R', `fruit_avg(dat, "berry")`, { waitForReady: false });
		await debug.expectBrowserModeFrame(1);

		// Verify the debug pane and call stack
		await verifyDebugPane(app);
		await verifyCallStack(app);
		await verifyVariableInConsole(page, 'pattern', '[1] "berry"');
		await verifyVariableInConsole(page, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

		// Step into using the debugger UI controls
		await debug.stepInto();
		await console.waitForConsoleContents(/debug at .*#3: cols <- grep\(pattern, names\(dat\)\)/);

		// Step over using the debugger UI controls
		await debug.stepOver();
		await console.waitForConsoleContents(/debug at .*#4: mini_dat <- dat\[, cols\]/);

		// Continue execution and check final message
		await debug.continue();
		await console.waitForConsoleContents('Found 2 fruits!');
	});

	test('R - Verify debugging with `debugonce()` pauses only once', async ({ app, page, executeCode, openFile, runCommand }) => {
		const { debug, console } = app.workbench;

		await openFile('workspaces/r-debugging/fruit_avg.r');
		await runCommand('r.sourceCurrentFile');

		// Trigger the function to be debugged (just once)
		await executeCode('R', 'debugonce(fruit_avg)');
		await executeCode('R', 'fruit_avg(dat, "berry")', { waitForReady: false });

		// First call should pause at debug prompt
		// Note: In R 4.3 browser "overcounts" the context depth but it is fixed in R 4.4
		const frameNumber = session.name.startsWith('R 4.3.') ? 2 : 1;
		await debug.expectBrowserModeFrame(frameNumber);

		// Continue execution
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');
		await console.waitForConsoleContents('Found 2 fruits!', { expectedCount: 1 });

		// Call again — should not pause this time
		await executeCode('R', 'fruit_avg(dat, "berry")', { waitForReady: false });
		await console.waitForConsoleContents('Found 2 fruits!', { expectedCount: 2 });
	});

	test('R - Verify debugging with `options(error = recover)` interactive recovery mode', async ({ app, page, openFile, runCommand, executeCode }) => {
		const { console } = app.workbench;

		await openFile('workspaces/r-debugging/fruit_avg.r');
		await runCommand('r.sourceCurrentFile');

		// Enable recovery mode so errors trigger the interactive debugger
		await executeCode('R', 'options(error = recover)');

		// Trigger an error: this should throw an error inside rowMeans(mini_dat)
		await executeCode('R', 'fruit_avg(dat, "black")', { waitForReady: false });

		// Confirm recovery prompt appears and frame selection is offered
		await console.waitForConsoleContents('Enter a frame number, or 0 to exit');
		await console.waitForConsoleContents('1: fruit_avg(dat, "black")');

		// Select the inner function frame
		await console.waitForConsoleContents('Selection:');
		await page.keyboard.type('1');
		await page.keyboard.press('Enter');

		// Confirm error message appears in sidebar
		await console.expectConsoleToContainError("'x' must be an array of at least two dimensions");

		// Check the contents of mini_dat in the console
		await console.focus();
		await verifyVariableInConsole(page, 'mini_dat', '[1] 4 9 6');

		// Quit the debugger
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
	});
});


async function verifyDebugPane(app: Application) {
	const { debug } = app.workbench;

	await debug.expectDebugPaneToContain('pattern, value "berry"');
	await debug.expectDebugPaneToContain('dat, value dat');
}

async function verifyCallStack(app: Application) {
	const { debug } = app.workbench;

	await debug.expectCallStackToContain('fruit_avg()fruit_avg()2:');
	await debug.expectCallStackToContain('<global>fruit_avg(dat, "berry")');
}

async function verifyVariableInConsole(page: Page, name: string, expectedText: string) {
	await test.step(`Verify variable in console: ${name}`, async () => {
		await page.keyboard.type(name);
		await page.keyboard.press('Enter');
		await expect(page.getByText(expectedText)).toBeVisible({ timeout: 30000 });
	});
}

