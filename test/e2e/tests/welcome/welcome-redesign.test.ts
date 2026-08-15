/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test as base, expect, tags } from '../_test.setup';

/**
 * Turn the setting on before the app launches, rather than through the settings
 * editor once it is running. `settingsFile` backs the file up and restores it at
 * worker teardown, so the setting cannot leak into another suite sharing this
 * worker, and the app never has to reload to pick it up.
 */
const test = base.extend<object, { beforeApp: void }>({
	beforeApp: [async ({ settingsFile }, use) => {
		await settingsFile.append({ 'welcomePage.experimental': true });
		await use();
	}, { scope: 'worker' }],
});

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

/**
 * The redesigned welcome page, behind the `welcomePage.experimental` setting.
 *
 * Kept separate from welcome.test.ts so the two never share an app: the tests
 * there assert the original page, which only renders with the setting off.
 *
 * When the setting becomes the default, these tests move into welcome.test.ts's
 * `Workspace` describe, whose `beforeEach` already matches this one. The
 * `beforeApp` wrapper above and this describe stay behind and go with the file.
 *
 * | Delete from welcome.test.ts | Replaced by |
 * |---|---|
 * | Verify page header, footer, content (Workspace) | Verify redesigned page renders... |
 * | Verify limited walkthroughs on Welcome page and full list in `More...` | nothing: the redesigned page has no walkthrough list, only a link to the quick pick |
 *
 * The two tab-order tests here have no counterpart to delete. They cover
 * setSlideInert, which belongs to the editor pane rather than to either page, so
 * one copy is enough and it lives with these tests.
 *
 * Two groups have no replacement yet, because the redesigned page has no Start
 * section: the four Python and R `new notebook` / `new file` tests, and the whole
 * `No Workspace` describe, which drives Open Folder, New Folder and New from Git.
 * Those need redesigned equivalents before the setting can flip.
 */
test.describe('Redesigned Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {

	test.beforeEach(async function ({ hotKeys, sessions }) {
		await sessions.expectNoStartUpMessaging();
		await hotKeys.openWelcomeWalkthrough();
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test('Verify redesigned page renders with the recent list, connect action and startup checkbox', async function ({ app }) {
		const { welcome } = app.workbench;

		await welcome.expectRedesignedPageToBeVisible();
		await welcome.expectRecentToBeVisible();
		await welcome.expectStartupCheckboxToBeVisible();
		app.web
			? await welcome.expectConnectToBeVisible(false)
			: await welcome.expectConnectToBeVisible(true);
	});

	test('Verify Tab does not reach the welcome page while a walkthrough is open', async function ({ app, runCommand }) {
		const { welcome } = app.workbench;

		await welcome.expectRedesignedPageToBeVisible();
		await openWalkthrough(app, runCommand);

		await welcome.expectHiddenSlideToBeInert('welcome');
	});

	test('Verify Tab does not reach a walkthrough opened earlier, which would shift the page', async function ({ app, hotKeys, runCommand }) {
		const { welcome } = app.workbench;

		await welcome.expectRedesignedPageToBeVisible();

		// Give the walkthrough slide real content, then come back. Its steps stay
		// in the DOM, parked off-screen to the right of the welcome page.
		await openWalkthrough(app, runCommand);
		await hotKeys.openWelcomeWalkthrough();
		await welcome.expectRedesignedPageToBeVisible();

		// Tabbing into it would scroll it into view and slide the welcome page
		// off the left edge.
		await welcome.expectHiddenSlideToBeInert('walkthrough');
	});

	test('Verify the environment setup card survives a tab switch', async function ({ app, runCommand }) {
		const { welcome } = app.workbench;

		await expect(welcome.environmentSetup).toBeVisible();
		// Settled means neither language still says "Checking...". Counting summary
		// elements is not enough -- the loading state renders one too, so the count
		// is satisfied the moment the card paints. Everything past that is the
		// real wording, which depends on how the machine is set up, so nothing
		// here asserts a particular sentence.
		await expect(welcome.environmentSetupSummary).toHaveCount(2, { timeout: 30000 });
		await expect(welcome.environmentSetupSummary.first()).not.toHaveText('Checking...', { timeout: 30000 });
		await expect(welcome.environmentSetupSummary.last()).not.toHaveText('Checking...', { timeout: 30000 });
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
