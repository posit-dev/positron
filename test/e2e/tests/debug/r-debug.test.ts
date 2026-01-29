/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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

import { Application, SessionMetaData } from '../../infra/index.js';
import { test, tags, expect } from '../_test.setup';

let session: SessionMetaData;

test.use({ suiteId: __filename });

test.describe('R Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN, tags.ARK]
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

	test('R - Verify call stack behavior and order', async ({ app, page }) => {
		const { debug, console, editors } = app.workbench;

		// Trigger the breakpoint
		await console.pasteCodeToConsole(`
		outer <- function(x) {
			inner(x)
		}

		inner <- function(y) {
			browser()
			y + 1
		}

		outer(5)`, true);

		await debug.expectBrowserModeFrame(1);

		// Verify call stack order
		await debug.expectCallStackAtIndex(0, 'inner(');
		await debug.expectCallStackAtIndex(1, 'outer(');
		await debug.expectCallStackAtIndex(2, '<global>');

		// Verify the call stack redirects to correct data frame(s)
		await debug.selectCallStackAtIndex(0);
		await editors.expectEditorToContain('inner <- function(y) {');

		await debug.selectCallStackAtIndex(1);
		await editors.expectEditorToContain('outer <- function(x) {');

		await debug.selectCallStackAtIndex(2);
		await editors.expectEditorToContain('outer(5)');

		await console.clearButton.click();
		await page.keyboard.press('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
	});

	test('R - Verify debugger indicator/highlight maintains focus during code execution', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7667' }] // uncomment line 133 when fixed
	},
		async ({ app, page, openFile, runCommand }) => {
			const { debug, console } = app.workbench;

			await openFile(`workspaces/r-debugging/fruit_avg_browser.r`);
			await runCommand('r.sourceCurrentFile');
			await page.waitForTimeout(500); // not sure why but in browser only this is needed to allow source to load

			// Trigger the breakpoint
			await console.pasteCodeToConsole(`fruit_avg(dat, "berry")`, true);
			await debug.expectBrowserModeFrame(1);

			// Verify current line indicator is visible
			await debug.expectCurrentLineIndicatorVisible();
			await debug.expectCurrentLineToBe(2);

			// Run random code in the console
			await console.pasteCodeToConsole('100 + 100', true);
			await console.waitForConsoleContents('[1] 200');
			// await debug.expectCurrentLineIndicatorVisible();
			await debug.expectCurrentLineToBe(2);

			// Step over and check current line
			await debug.stepOver();
			await debug.expectCurrentLineIndicatorVisible();
			await debug.expectCurrentLineToBe(3);

			// Step into and out and check current line
			await debug.stepInto();
			await debug.stepOut();
			await debug.expectCurrentLineIndicatorVisible();
			await debug.expectCurrentLineToBe(4);

			// Continue execution and check final message
			await debug.continue();
			await console.waitForConsoleContents('Found 2 fruits!');
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
		await verifyVariableInConsole(app, 'pattern', '[1] "berry"');
		await verifyVariableInConsole(app, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

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
		await verifyVariableInConsole(app, 'pattern', '[1] "berry"');
		await verifyVariableInConsole(app, 'names(dat)', '[1] "blackberry" "blueberry"  "peach" "plum"');

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
		await executeCode('R', 'debugonce(fruit_avg)', { waitForReady: false });
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
});

// R Breakpoints - Tests for gutter-click breakpoints feature (#1766)
// These tests verify the new R breakpoint support added in PR #11407
test.describe('R Breakpoints', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN, tags.ARK]
}, () => {
	let breakpointSession: SessionMetaData;

	test.beforeAll(async ({ sessions }) => {
		breakpointSession = await sessions.start('r');
	});

	test.afterEach(async ({ app, page, hotKeys }) => {
		// Focus the console
		await app.workbench.console.focus();

		// Exit debug mode if we're in it (send Q to quit)
		const consoleContent = await app.workbench.console.activeConsole.textContent();
		if (consoleContent?.includes('Browse[')) {
			await page.keyboard.type('Q');
			await page.keyboard.press('Enter');
			await app.workbench.console.waitForReady('>');
		}

		// Clear breakpoints
		await app.workbench.debug.clearBreakpoints();

		// Close all editors (handles "Don't Save" dialog)
		await hotKeys.closeAllEditors();

		// Clear console
		await app.workbench.console.clearButton.click();
	});

	test('R - Verify breakpoint set and hit via gutter click', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1766' }]
	}, async ({ app, page, openFile, hotKeys }) => {
		const { debug, console } = app.workbench;

		await openFile('workspaces/r-debugging/breakpoint_test.r');

		// Set a breakpoint on line 3 (inside the multiply_values function)
		await debug.setUnverifiedBreakpointOnLine(3);

		// Execute code with Ctrl/Cmd+Enter to verify the breakpoint
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');

		// Wait for the breakpoint to become verified (red)
		await debug.expectBreakpointVerified(0, 30000);

		// Call the function to trigger the breakpoint
		await console.pasteCodeToConsole('multiply_values(5, 3)', true);

		// Verify we hit the breakpoint
		await debug.expectBrowserModeFrame(1);
		await debug.expectDebugToolbarVisible();
		await debug.expectCurrentLineIndicatorVisible();
		await debug.expectCallStackAtIndex(0, 'multiply_values(');

		// Continue and verify result
		await page.keyboard.type('c');
		await page.keyboard.press('Enter');
		await console.waitForConsoleContents('[1] 15');

		// Quit debugging
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
	});

	test('R - Verify breakpoints in dirty (unsaved) documents', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1766' }]
	}, async ({ app, page, openFile, hotKeys }) => {
		const { debug, console } = app.workbench;

		await openFile('workspaces/r-debugging/breakpoint_test.r');
		await debug.setUnverifiedBreakpointOnLine(3);

		// Verify the breakpoint
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Edit file to make it dirty
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('# test comment');

		// Breakpoint should become unverified after edit
		await debug.expectBreakpointUnverified(0);

		// Re-execute WITHOUT saving - breakpoint should re-verify
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Verify breakpoint still works
		await console.pasteCodeToConsole('multiply_values(5, 3)', true);
		await debug.expectBrowserModeFrame(1);

		// Exit debugger and clean up
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
		await hotKeys.undo();
		await hotKeys.undo();
	});

	test('R - Verify session switching preserves breakpoint state', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1766' }]
	}, async ({ app, page, openFile, hotKeys, sessions }) => {
		const { debug, console } = app.workbench;

		// Start a second R session
		const rSession2 = await sessions.start('r', { reuse: false });

		// Switch back to first session (use ID since both have same name)
		await sessions.select(breakpointSession.id);

		await openFile('workspaces/r-debugging/breakpoint_test.r');
		await debug.setUnverifiedBreakpointOnLine(3);

		// Verify breakpoint in Session 1
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Switch to Session 2 - breakpoint should be unverified
		await sessions.select(rSession2.id);
		await debug.expectBreakpointUnverified(0);

		// Switch back to Session 1 - breakpoint should still be verified
		await sessions.select(breakpointSession.id);
		await debug.expectBreakpointVerified(0, 5000);

		// Verify breakpoint still works
		await console.pasteCodeToConsole('multiply_values(5, 3)', true);
		await debug.expectBrowserModeFrame(1);

		// Exit debugger
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');

		// Shutdown second session
		await sessions.select(rSession2.id);
		await sessions.delete(rSession2.id);
	});

	test('R - Verify debug-specific console history', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/11402' }]
	}, async ({ app, page, openFile, hotKeys }) => {
		const { debug, console } = app.workbench;

		// Type normal commands first
		await console.typeToConsole('normal_x <- 1', true);
		await console.typeToConsole('normal_y <- 2', true);

		// Set up breakpoint
		await openFile('workspaces/r-debugging/breakpoint_test.r');
		await debug.setUnverifiedBreakpointOnLine(3);
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Trigger breakpoint and type debug commands
		await console.pasteCodeToConsole('multiply_values(5, 3)', true);
		await debug.expectBrowserModeFrame(1);
		await console.typeToConsole('debug_var <- 100', true);
		await console.typeToConsole('print(a)', true);
		await app.code.wait(1000);

		// Ctrl+R should show debug commands
		await page.keyboard.press('Control+R');
		await console.waitForHistoryContents('debug_var <- 100');
		await console.waitForHistoryContents('print(a)');
		await page.keyboard.press('Escape');

		// Exit debugger
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
		await app.code.wait(1000);

		// Ctrl+R should now show normal commands
		await page.keyboard.press('Control+R');
		await console.waitForHistoryContents('normal_x <- 1');
		await console.waitForHistoryContents('normal_y <- 2');
		await page.keyboard.press('Escape');
	});

	test('R - Verify DAP disconnect/reconnect preserves breakpoints', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1766' }]
	}, async ({ app, page, openFile, hotKeys }) => {
		const { debug, console } = app.workbench;

		await openFile('workspaces/r-debugging/breakpoint_test.r');
		await debug.setUnverifiedBreakpointOnLine(3);

		// Verify breakpoint
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Disconnect DAP with Shift+F5
		await page.keyboard.press('Shift+F5');
		await page.waitForTimeout(2000);

		// Breakpoint should still be verified after auto-reconnect
		await debug.expectBreakpointVerified(0, 10000);

		// Verify breakpoint still works
		await console.pasteCodeToConsole('multiply_values(5, 3)', true);
		await debug.expectBrowserModeFrame(1);

		// Exit debugger
		await page.keyboard.type('Q');
		await page.keyboard.press('Enter');
		await console.waitForReady('>');
	});

	test('R - Verify editing file while at breakpoint invalidates breakpoints', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/1766' }]
	}, async ({ app, page, openFile, hotKeys }) => {
		const { debug, console } = app.workbench;

		await openFile('workspaces/r-debugging/breakpoint_test.r');
		await debug.setUnverifiedBreakpointOnLine(3);

		// Verify breakpoint
		await hotKeys.selectAll();
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
		await debug.expectBreakpointVerified(0, 30000);

		// Trigger breakpoint
		await debug.expectBrowserModeFrame(1);

		// Edit file while at breakpoint
		await app.workbench.editors.selectTab('breakpoint_test.r');
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
		await page.keyboard.press('Enter');
		await page.keyboard.type('# edit while debugging');
		await page.keyboard.press('Enter');

		// Breakpoint should become unverified
		await debug.expectBreakpointUnverified(0);

		// Continue - invalidated breakpoint should NOT trigger again
		await console.focus();
		await page.keyboard.type('c', { delay: 100 });
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

	await debug.expectCallStackAtIndex(0, 'fruit_avg(');
	await debug.expectCallStackAtIndex(1, '<global>');
}

async function verifyVariableInConsole(app: Application, name: string, expectedText: string) {
	await test.step(`Verify variable in console: ${name}`, async () => {
		await app.workbench.console.focus();
		await app.code.driver.page.keyboard.type(name);
		await app.code.driver.page.keyboard.press('Enter');
		await expect(app.code.driver.page.getByText(expectedText)).toBeVisible({ timeout: 30000 });
	});
}
