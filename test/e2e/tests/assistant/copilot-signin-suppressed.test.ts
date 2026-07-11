/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * Upstream surfaces Copilot chat-setup affordances that read as GitHub Copilot, not Positron.
 * Positron suppresses them in chatSetupContributions.ts; these e2e assertions guard against
 * them reappearing on a VS Code merge.
 *
 * Most of these affordances are gated on `Setup.hidden.negate()`, and Positron defaults
 * `chat.disableAIFeatures` to true (so `hidden` is true at launch). That means upstream
 * wouldn't render them in the default state anyway, so a test in that state passes whether or
 * not the suppression is in place. To actually exercise the suppression we flip AI features on
 * for those checks (see the second describe). The "Use AI Features" on-ramp is the exception:
 * it shows precisely when chat is hidden, so it stays in the default state.
 *
 * Not covered:
 * - The title-bar "Sign In" button: also gated behind the `chat.signInTitleBar.enabled`
 *   experiment (and hidden on web / when the update button shows), so it can't be driven into
 *   view in a realistic state. Suppressed in source; left unverified here.
 * - The onboarding wizard only auto-shows for a brand-new profile, which the reused e2e
 *   profile isn't, so it stays a manual check.
 *
 * @see https://github.com/posit-dev/positron/issues/13955
 */

// The menu DOM exposes only the label (no command id), so before each absence check we
// confirm the surface actually rendered (otherwise a zero count proves nothing). Distinctive
// wording is matched loosely (catches a renamed re-add); generic labels are matched exactly.
const AI_SIGNIN_CONCEPT = /copilot|ai features/i;
const EDITOR_PRESETUP_ITEMS = ['Explain', 'Fix', 'Code Review'];
const HIDE_AI_COMMAND = 'Learn How to Hide AI Features';
const USE_AI_FEATURES_COMMAND = 'Use AI Features with Copilot for free';

test.describe('Assistant: Copilot setup on-ramp suppressed', { tag: [tags.WIN, tags.ASSISTANT] }, () => {

	test('Command palette does not list the Copilot "Use AI Features with Copilot for free..." command', async function ({ app }) {
		const { hotKeys, quickInput } = app.workbench;

		await hotKeys.openCommandPalette();
		await quickInput.type(`>${USE_AI_FEATURES_COMMAND}`);
		// Wait for the palette to return a result first, so the count below is meaningful.
		await quickInput.waitForQuickInputElementText();

		// In the default state AI features are off, so this command's precondition gates
		// it out of the palette (it only reappears once AI is enabled). The palette then
		// falls back to fuzzy "similar commands", so assert the exact title isn't among them.
		await expect(
			quickInput.quickInputResult.filter({ hasText: USE_AI_FEATURES_COMMAND })
		).toHaveCount(0);

		await quickInput.closeQuickInput();
	});
});

// These affordances are gated on AI features being enabled (their `when` includes
// `Setup.hidden.negate()`), but Positron defaults `chat.disableAIFeatures` to true, so they're
// already hidden by that gate. We turn AI features on so the gate passes and the dropped menu /
// f1 entries are the only thing keeping them out of view; otherwise the assertions would pass
// trivially. The default is restored afterward.
test.describe('Assistant: Copilot sign-in surfaces suppressed with AI features on', { tag: [tags.WIN, tags.ASSISTANT] }, () => {

	test.beforeAll(async ({ settings }) => {
		await settings.set({ 'chat.disableAIFeatures': false }, { reload: true });
	});

	test.afterAll(async ({ settings, app }) => {
		await settings.remove(['chat.disableAIFeatures']);
		await app.workbench.hotKeys.reloadWindow(true);
	});

	test('Signed-out user sees no Copilot AI sign-in entry in the Accounts menu', async function ({ page }) {
		// Accounts button lives in the activity bar; its aria-label gets a badge suffix when
		// signed out (e.g. "Accounts - Sign in ..."), so scope to the activity bar and match
		// the prefix rather than the exact name.
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
