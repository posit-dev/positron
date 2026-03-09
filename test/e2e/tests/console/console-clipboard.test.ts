/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';
import { TestTags } from '../../infra';

test.use({
	suiteId: __filename
});

const testCases = [
	{
		language: 'python',
		testLine: 'a = 1',
		prompt: '>>>',
		restartRegex: /Python .+ restarted\./,
		extraTags: [] as TestTags[],
	},
	{
		language: 'r',
		testLine: 'a <- 1',
		prompt: '>',
		restartRegex: /R .+ restarted\./,
		extraTags: [tags.ARK] as TestTags[],
	},
] as const;

test.describe('Console - Clipboard', { tag: [tags.CONSOLE, tags.WIN, tags.WEB] }, () => {

	for (const { language, testLine, prompt, restartRegex, extraTags } of testCases) {

		test(`${language} - Verify copy from console & paste to console`, { tag: extraTags }, async ({ app, sessions, runCommand, hotKeys }) => {
			const { console, clipboard } = app.workbench;

			// start a new session
			await sessions.start(language);

			// clear the console and wait for it to be ready
			await console.sendEnterKey();
			await console.clearButton.click();

			// type a line, select it, copy it, and paste it back into the console
			await console.typeToConsole(testLine);
			await hotKeys.selectAll();
			await hotKeys.copy();
			await console.sendEnterKey();
			await console.waitForConsoleExecution();
			await console.waitForConsoleContents(testLine);

			// clear the console, paste the copied line, and execute it
			await console.clearButton.click();
			// Pass text to clipboard.paste() for WebKit compatibility (uses synthetic paste event)
			await clipboard.paste(testLine);
			await console.waitForCurrentConsoleLineContents(testLine.replaceAll(' ', ' '));
			await console.sendEnterKey();
			await console.waitForConsoleExecution();
			await console.waitForConsoleContents(testLine);
		});

		test(`${language} - Verify copy from console & paste to console with context menu`, {
			tag: [tags.WEB_ONLY, ...extraTags],
		}, async ({ app, sessions }, testInfo) => {
			// Context menu clipboard tests don't work on Firefox or WebKit. Is this a bug?
			test.skip(
				testInfo.project.name.includes('firefox') || testInfo.project.name.includes('webkit'),
				'Clipboard context menu not properly supported on Firefox/WebKit'
			);

			// start a new session
			const { console, terminal } = app.workbench;
			await sessions.start(language);

			// clear the console and wait for it to be ready
			await console.clearButton.click();
			await console.restartButton.click();
			await console.waitForReady(prompt);

			// type a line, select it, copy it, and paste it back into the console
			await expect(async () => {
				await terminal.handleContextMenu(console.activeConsole, 'Select All');
				await app.code.wait(1000);
				await terminal.handleContextMenu(console.activeConsole, 'Copy');

				const clipboardText = await app.workbench.clipboard.getClipboardText();
				expect(clipboardText).toMatch(restartRegex);
			}).toPass({ timeout: 30000 });
		});
	}
});
