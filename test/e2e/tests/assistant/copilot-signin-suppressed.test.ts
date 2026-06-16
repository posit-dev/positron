/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * On a signed-out launch, upstream surfaces Copilot chat-setup affordances that read as
 * GitHub Copilot, not Positron. Positron suppresses them in chatSetupContributions.ts;
 * these e2e assertions guard against them reappearing on a VS Code merge.
 *
 * Not covered: the onboarding wizard only auto-shows for a brand-new profile, which the
 * reused e2e profile isn't, so it stays a manual check.
 *
 * @see https://github.com/posit-dev/positron/issues/13955
 */

// The menu DOM exposes only the label (no command id), so before each absence check we
// confirm the surface actually rendered (otherwise a zero count proves nothing). Distinctive
// wording is matched loosely (catches a renamed re-add); generic labels are matched exactly.
const AI_SIGNIN_CONCEPT = /copilot|ai features/i;
const TITLE_BAR_SIGN_IN = 'Sign In';
const EDITOR_PRESETUP_ITEMS = ['Explain', 'Fix', 'Code Review'];
const HIDE_AI_COMMAND = 'Learn How to Hide AI Features';
const USE_AI_FEATURES_COMMAND = 'Use AI Features with Copilot for free';

test.describe('Assistant: Copilot sign-in surfaces suppressed', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {

	test('Signed-out user sees no Copilot AI sign-in entry in Accounts menu or title bar', async function ({ app, page }) {
		await test.step('Accounts menu has no AI/Copilot sign-in entry', async () => {
			// Accounts button lives in the activity bar; its aria-label gets a badge
			// suffix when signed out (e.g. "Accounts - Sign in ..."), so scope to the
			// activity bar and match the prefix rather than the exact name.
			const accountsButton = page.locator('.activitybar')
				.getByRole('button', { name: /^Accounts/ });
			await expect(accountsButton).toBeVisible();
			await accountsButton.click();

			const menu = page.locator('.monaco-menu');
			await expect(menu).toBeVisible();
			// Confirm items rendered first, so the count below means the AI entry is gone.
			await expect(menu.getByRole('menuitem').first()).toBeVisible();

			// Loose match (not the exact label) catches a reworded re-add.
			await expect(menu.getByRole('menuitem', { name: AI_SIGNIN_CONCEPT })).toHaveCount(0);

			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();
		});

		await test.step('Title bar has no "Sign In" button', async () => {
			// Where ChatSetupSignInTitleBarAction would render when signed out. The upstream
			// button is also gated behind the `chat.signInTitleBar.enabled` experiment, so
			// this is a coarse guard; "Sign In" is too generic to widen.
			await expect(page.getByRole('button', { name: TITLE_BAR_SIGN_IN, exact: true })).toHaveCount(0);
		});
	});

	test('Signed-out user sees no Copilot pre-setup entries in the editor context menu', async function ({ page, openFile }) {
		await openFile('workspaces/generate-data-frames-r/simple-data-frames.r');

		// Upstream contributes Explain / Fix / Code Review here while signed out.
		await page.locator('.monaco-editor .view-line').first().click({ button: 'right' });

		const menu = page.locator('.monaco-menu');
		await expect(menu).toBeVisible();
		// Confirm the menu rendered first, so a 0-count below is meaningful.
		await expect(menu.getByRole('menuitem').first()).toBeVisible();

		// Exact match: these verbs are too generic to widen (e.g. another extension's "Fix").
		for (const label of EDITOR_PRESETUP_ITEMS) {
			await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
		}

		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
	});

	test('Command palette does not list the Copilot "Use AI Features with Copilot for free..." command', async function ({ app }) {
		const { hotKeys, quickInput } = app.workbench;

		await hotKeys.openCommandPalette();
		await quickInput.type(`>${USE_AI_FEATURES_COMMAND}`);
		// Wait for the palette to return a result first, so the count below is meaningful.
		await quickInput.waitForQuickInputElementText();

		// With the f1 entry suppressed, the palette falls back to fuzzy "similar commands",
		// so assert the exact command title isn't among them.
		await expect(
			quickInput.quickInputResult.filter({ hasText: USE_AI_FEATURES_COMMAND })
		).toHaveCount(0);

		await quickInput.closeQuickInput();
	});
});

// "Learn How to Hide AI Features" is gated on AI features being enabled (its precondition is
// Setup.hidden.negate()), but Positron defaults chat.disableAIFeatures to true, so the command
// is already hidden by its own precondition. We flip AI features on for this check so the
// precondition passes and the dropped f1 entry is the only thing keeping it out of the palette;
// otherwise the assertion would pass trivially. The default is restored afterward.
test.describe('Assistant: "Learn How to Hide AI Features" suppressed with AI features on', { tag: [tags.WIN, tags.ASSISTANT, tags.WEB] }, () => {

	test.beforeAll(async ({ settings }) => {
		await settings.set({ 'chat.disableAIFeatures': false }, { reload: true });
	});

	test.afterAll(async ({ settings, app }) => {
		await settings.remove(['chat.disableAIFeatures']);
		await app.workbench.hotKeys.reloadWindow(true);
	});

	test('Command palette does not list the Copilot "Learn How to Hide AI Features" command', async function ({ app }) {
		const { hotKeys, quickInput } = app.workbench;

		await hotKeys.openCommandPalette();
		await quickInput.type(`>${HIDE_AI_COMMAND}`);
		// Wait for the palette to return a result first, so the count below is meaningful.
		await quickInput.waitForQuickInputElementText();

		// With the f1 entry suppressed, the palette falls back to fuzzy "similar commands",
		// so assert the exact command title isn't among them.
		await expect(
			quickInput.quickInputResult.filter({ hasText: HIDE_AI_COMMAND })
		).toHaveCount(0);

		await quickInput.closeQuickInput();
	});
});
