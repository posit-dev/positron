/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

type RunCommand = (commandId: string, options?: { keepOpen?: boolean; exactLabelMatch?: boolean }) => Promise<void>;

/**
 * Open a walkthrough from the command palette, which switches the editor to the
 * details slide and leaves the welcome page off-screen behind it.
 *
 * `keepOpen` stops runCommand from re-clicking until the picker closes: this
 * command opens a second picker of its own, and that retry loop would dismiss it
 * before the test could use it. Filter before selecting, because the list is
 * virtualized and an unfiltered match can sit in the DOM scrolled out of view
 * where it cannot be clicked.
 */
async function openWalkthrough(app: Application, runCommand: RunCommand) {
	const { quickInput } = app.workbench;

	await runCommand('welcome.showAllWalkthroughs', { keepOpen: true });
	await quickInput.waitForQuickInputOpened({ timeout: 30000 });
	await quickInput.type('Migrating from VSCode');
	await quickInput.selectQuickInputElementContaining('Migrating from VSCode to Positron');
}

test.describe('Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {

	test.beforeEach(async function ({ hotKeys, sessions }) {
		await sessions.expectNoStartUpMessaging();
		await hotKeys.openWelcomeWalkthrough();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Verify page renders with the header, recent list, connect action and startup checkbox', async function ({ app }) {
		const { welcome } = app.workbench;

		await welcome.expectPageToBeVisible();
		await welcome.expectHeaderToBeVisible();
		await welcome.expectRecentToBeVisible();
		await welcome.expectStartupCheckboxToBeVisible();
		await welcome.expectTabTitleToBe('Welcome');
		app.web
			? await welcome.expectConnectToBeVisible(false)
			: await welcome.expectConnectToBeVisible(true);
	});

	test('Verify the walkthrough banner opens the full list of walkthroughs', async function ({ app }) {
		const { welcome, quickInput } = app.workbench;

		await welcome.expectPageToBeVisible();
		await welcome.seeAllWalkthroughsButton.click();

		await quickInput.expectTitleBarToHaveText('Open Walkthrough...');
		await quickInput.expectQuickInputResultsToContain([
			'Get Started with Positron',
			'Migrating from VSCode to Positron',
			'Migrating from RStudio to Positron',
			'Get Started with Jupyter Notebooks',
			'Get Started with Posit Publisher',
			'Jupyter Notebooks in Positron'
		]);

		// Upstream walkthroughs that Positron hides. "Get Started with
		// Positron" is deliberately absent from this list: the hidden
		// upstream `Setup` walkthrough shares its title with the Positron
		// one that replaces it.
		await quickInput.expectQuickInputResultsToNotContain([
			'Get Started with Python Development',
			'Learn the Fundamentals',
			'GitHub Copilot'
		]);
	});

	test('Verify Tab does not reach the welcome page while a walkthrough is open', async function ({ app, runCommand }) {
		const { welcome } = app.workbench;

		await welcome.expectPageToBeVisible();
		await openWalkthrough(app, runCommand);

		await welcome.expectHiddenSlideToBeInert('welcome');
	});

	test('Verify Tab does not reach a walkthrough opened earlier, which would shift the page', async function ({ app, hotKeys, runCommand }) {
		const { welcome } = app.workbench;

		await welcome.expectPageToBeVisible();

		// Give the walkthrough slide real content, then come back. Its steps stay
		// in the DOM, parked off-screen to the right of the welcome page.
		await openWalkthrough(app, runCommand);
		await hotKeys.openWelcomeWalkthrough();
		await welcome.expectPageToBeVisible();

		// Tabbing into it would scroll it into view and slide the welcome page
		// off the left edge.
		await welcome.expectHiddenSlideToBeInert('walkthrough');
	});

	test('Verify the environment setup card survives a tab switch', async function ({ app, runCommand }) {
		const { welcome } = app.workbench;

		await expect(welcome.environmentSetup).toBeVisible();
		// Settled means both languages have a summary line, which only the settled
		// states render -- a language still checking has none. Waiting on one of
		// them is not enough: R often finishes while Python is still running. The
		// wording depends on how the machine is set up, so nothing here asserts a
		// particular sentence.
		await expect(welcome.environmentSetupSummary).toHaveCount(2, { timeout: 30000 });
		const settled = await welcome.environmentSetupSummary.allTextContents();

		// A different editor needs a different pane, which is the path that calls
		// clearInput on the welcome pane.
		await runCommand('workbench.action.files.newUntitledFile');
		await runCommand('workbench.action.previousEditor');
		await expect(welcome.environmentSetup).toBeVisible();

		// What this does and does not prove. It catches the card coming back blank,
		// stuck loading, or re-running its checks slowly enough to be seen. It
		// cannot prove the checks were not silently re-run: a re-check lands on
		// the same answer, so a fast one is invisible from the DOM. Reverting the
		// input-keying in gettingStarted.ts leaves this test passing.
		//
		// Read the count once rather than asserting it retryably -- a retrying
		// toHaveCount(0) would wait for any re-check to finish and then pass.
		expect(await welcome.environmentSetupProgress.count()).toBe(0);
		// Same reason for the short timeout: the summary has to be there *now*,
		// not after a re-check has had time to refill it.
		await expect(welcome.environmentSetupSummary).toHaveText(settled, { timeout: 2000 });
	});
});
