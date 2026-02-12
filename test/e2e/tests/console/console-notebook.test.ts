/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { tags } from '../_test.setup';
import { test } from '../notebooks-positron/_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Notebook → Console Interaction (no shared state assumed)', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS, tags.CONSOLE, tags.CRITICAL]
}, () => {

	test.afterEach(async ({ app, settings }, testInfo) => {
		const { notebooksPositron, console } = app.workbench;

		// Log console contents on failure for debugging
		if (testInfo.status !== 'passed') {
			await console.logConsoleContents();
		}

		await notebooksPositron.expectNoActiveSpinners();
		await settings.remove(['console.showNotebookConsoleActions']);
	});

	/**
	 * Wait until console is actually ready for typing
	 * (prompt visible != input ready)
	 */
	async function prepareConsoleForUse(console: any, prompt: string) {
		await test.step('Prepare console for use', async () => {
			await console.waitForReady(prompt, 30000);

			// Verify input accepts keystrokes with retry logic
			await expect(async () => {
				const input = console.inputEditor;
				await expect(input).toBeVisible();

				await input.click();
				await input.type('1');
				await input.press('Backspace');
			}).toPass({ timeout: 15000 });
		});
	}

	async function openNotebookConsoleAndFocus(
		notebooksPositron: any,
		console: any,
		prompt: string,
		sessions: any
	) {
		await test.step('Open notebook console and focus', async () => {
			const sessionCountBefore = await sessions.getSessionCount();

			await notebooksPositron.kernel.openNotebookConsole();

			// Verify new session was created
			await sessions.expectSessionCountToBe(sessionCountBefore + 1, 'all');

			await prepareConsoleForUse(console, prompt);
		});
	}

	/**
	 * Self-contained REPL execution probe
	 * Verifies console can execute code without relying on notebook variables
	 */
	async function verifyConsoleExec(console: any, lang: 'python' | 'r') {
		await test.step('Verify console can execute code', async () => {
			await console.focus();
			await console.typeToConsole('print(6 * 7)');
			await console.sendEnterKey();
			await console.waitForConsoleExecution();

			if (lang === 'python') {
				// Note: expectedCount accounts for console buffer accumulation
				await console.waitForConsoleContents(/\b42\b/, { expectedCount: 2 });
			} else {
				await console.waitForConsoleContents('[1] 42', { expectedCount: 2 });
			}
		});
	}

	test.skip('Console remains usable after notebook cell execution (Python)',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute notebook cell', async () => {
				await notebooksPositron.addCodeToCell(0, 'x = 42', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('Console remains usable after executing multiple notebook cells',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute multiple notebook cells', async () => {
				await notebooksPositron.addCodeToCell(0, 'a = 10', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);

				await notebooksPositron.addCell('code');
				await notebooksPositron.addCodeToCell(1, 'b = 20', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(1, 'idle', 30000);

				await notebooksPositron.addCell('code');
				await notebooksPositron.addCodeToCell(2, 'c = a + b', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(2, 'idle', 30000);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('Console usable after large notebook output',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute cell with large output', async () => {
				await notebooksPositron.addCodeToCell(
					0,
					`
for i in range(200):
    print(i)
`,
					{
						run: true,
						waitForSpinner: true
					}
				);
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);

				const output = notebooksPositron.cell.nth(0).getByTestId('cell-output');
				await output.evaluate((node) => { node.scrollTop = node.scrollHeight; });
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('Console usable after busy → idle kernel transition',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute long-running cell', async () => {
				await notebooksPositron.addCodeToCell(
					0,
					`
import time
time.sleep(2)
`,
					{
						run: true,
						waitForSpinner: true
					}
				);
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('Console usable after Run button execution',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select kernel', async () => {
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute cell via Run button', async () => {
				await notebooksPositron.addCodeToCell(0, 'y = 5');
				await notebooksPositron.runCellButtonAtIndex(0).click();
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('R console remains usable after notebook execution',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup: Enable notebook console actions', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
			});

			await test.step('Create notebook and select R kernel', async () => {
				await notebooksPositron.newNotebook();
				await expect(async () => {
					await notebooksPositron.kernel.select('R');
				}).toPass({ timeout: 30000 });
			});

			await test.step('Open notebook console', async () => {
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>', sessions);
			});

			await test.step('Execute notebook cell', async () => {
				await notebooksPositron.addCodeToCell(0, 'x <- 100', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>');
				await verifyConsoleExec(console, 'r');
			});
		}
	);

	test.skip('Console can access variables defined in notebook',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Define variable in notebook', async () => {
				await notebooksPositron.addCodeToCell(0, 'notebook_var = "from notebook"', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Access variable from console', async () => {
				await console.focus();
				await console.typeToConsole('print(notebook_var)');
				await console.sendEnterKey();
				await console.waitForConsoleExecution();
				await console.waitForConsoleContents('from notebook', {});
			});
		}
	);

	test.skip('Console usable after notebook cell raises exception',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Execute cell with error', async () => {
				await notebooksPositron.addCodeToCell(0, 'raise ValueError("test error")', {
					run: true,
					waitForSpinner: true
				});

				// Wait for execution to complete (spinner disappears even with error)
				await notebooksPositron.expectSpinnerAtIndex(0, false);
			});

			await test.step('Verify console remains usable', async () => {
				await prepareConsoleForUse(console, '>>>');
				await verifyConsoleExec(console, 'python');
			});
		}
	);

	test.skip('Console reconnects after notebook kernel restart',
		async ({ app, sessions, settings }) => {
			const { notebooksPositron, console } = app.workbench;

			await test.step('Setup', async () => {
				await settings.set({ 'console.showNotebookConsoleActions': true });
				await notebooksPositron.newNotebook();
				await notebooksPositron.kernel.select('Python');
				await openNotebookConsoleAndFocus(notebooksPositron, console, '>>>', sessions);
			});

			await test.step('Define variable before restart', async () => {
				await notebooksPositron.addCodeToCell(0, 'x = 100', {
					run: true,
					waitForSpinner: true
				});
				await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
			});

			await test.step('Restart kernel', async () => {
				await notebooksPositron.kernel.restart({ waitForRestart: true });
				await notebooksPositron.kernel.expectStatusToBe('idle', 30000);
			});

			await test.step('Verify console reconnected and state cleared', async () => {
				await console.waitForReady('>>>', 30000);
				await console.focus();

				// Verify variable no longer exists (fresh interpreter)
				await console.typeToConsole('print(x)');
				await console.sendEnterKey();
				await console.waitForConsoleExecution();
				await console.waitForConsoleContents(/NameError.*'x'/, {});
			});
		}
	);

	test.skip('R console handles data frames after notebook execution', {
		tag: [tags.ARK]
	}, async ({ app, sessions, settings }) => {
		const { notebooksPositron, console } = app.workbench;

		await test.step('Setup', async () => {
			await settings.set({ 'console.showNotebookConsoleActions': true });
			await notebooksPositron.newNotebook();
			await expect(async () => {
				await notebooksPositron.kernel.select('R');
			}).toPass({ timeout: 30000 });
			await openNotebookConsoleAndFocus(notebooksPositron, console, '>', sessions);
		});

		await test.step('Create data frame in notebook', async () => {
			const dfCode = 'df <- data.frame(x = 1:3, y = c("a", "b", "c"))';
			await notebooksPositron.addCodeToCell(0, dfCode, {
				run: true,
				waitForSpinner: true
			});
			await notebooksPositron.expectExecutionStatusToBe(0, 'idle', 30000);
		});

		await test.step('Access data frame from console', async () => {
			await console.focus();
			await console.typeToConsole('print(df)');
			await console.sendEnterKey();
			await console.waitForConsoleExecution();
			await console.waitForConsoleContents('1 a', { expectedCount: 2 });
		});
	});

});
