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
 * Positron doesn't ship GitHub Copilot, so it always reports chat setup as hidden
 * (`ChatEntitlementContext.withConfiguration`), whatever `chat.disableAIFeatures` says. Most of
 * these affordances are gated on `Setup.hidden.negate()`, so that alone hides them; the dropped
 * menu / f1 entries are a second line of defense. The "Use AI Features" on-ramp is the reverse:
 * upstream shows it precisely when setup is hidden, so Positron drops its f1 entry.
 *
 * All checks run with `chat.disableAIFeatures: false`, the opted-in state that users who used
 * Copilot Chat carry over. In the default state AI features are off and every surface is gated
 * out anyway, so a test there would pass whether or not the suppression is in place.
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
const CHAT_STATUS_ITEM = '.statusbar-item[id="chat.statusBarEntry"]';

// Turn AI features on so the `chatAiFeaturesEnabled` gate passes and only the setup suppression
// keeps these surfaces out of view. The default is restored afterward.
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

	test('Status bar has no Copilot chat status item', async function ({ page }) {
		// Positron doesn't register the chat status bar entry (Copilot's status, sign-in,
		// and quota menu). Confirm the status bar rendered first, so the count is meaningful.
		await expect(page.locator('.statusbar-item').first()).toBeVisible();
		await expect(page.locator(CHAT_STATUS_ITEM)).toHaveCount(0);
	});

	test('Command palette does not list the Copilot "Use AI Features with Copilot for free..." command', async function ({ app }) {
		const { hotKeys, quickInput } = app.workbench;

		await hotKeys.openCommandPalette();
		await quickInput.type(`>${USE_AI_FEATURES_COMMAND}`);
		// Wait for the palette to return a result first, so the count below is meaningful.
		await quickInput.waitForQuickInputElementText();

		// Upstream lists this command while chat setup is hidden, which in Positron is always.
		// Positron drops its f1 entry, so the palette falls back to fuzzy "similar commands";
		// assert the exact title isn't among them.
		await expect(
			quickInput.quickInputResult.filter({ hasText: USE_AI_FEATURES_COMMAND })
		).toHaveCount(0);

		await quickInput.closeQuickInput();
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
