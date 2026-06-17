/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * Verifies that the "Chat" command category is hidden from the command palette
 * when AI features are disabled via the `chat.disableAIFeatures` setting.
 *
 * The change swaps Chat command preconditions from `ChatContextKeys.enabled` to
 * `ChatContextKeys.available` (enabled AND `chat.disableAIFeatures` not set), and
 * a command's precondition gates its command palette visibility. The palette
 * renders these commands with a "Chat: " category prefix
 * (see commandsQuickAccess.ts "commandWithCategory").
 *
 * The e2e settings fixture enables Positron Assistant (`positron.assistant.enable`),
 * which registers the default chat participant, so chat is "enabled" by default and
 * the "Chat" category is shown until AI features are explicitly disabled.
 *
 * @see https://github.com/posit-dev/positron/pull/14054 (single-command gating this extends)
 */
test.describe('Chat Command Palette Gating', { tag: [tags.ASSISTANT, tags.POSIT_ASSISTANT] }, () => {
	// Command palette rows in the "Chat" category render as "Chat: <title>".
	// Anchor at the start so other categories (e.g. "GitHub Copilot Chat: ...") are excluded.
	const CHAT_CATEGORY_ROW = /^Chat: /;

	test.afterEach('Reset chat.disableAIFeatures', async function ({ settings }) {
		await settings.remove(['chat.disableAIFeatures']);
	});

	test('Chat category is hidden when AI features are disabled', async function ({ app, settings }) {
		await settings.set({ 'chat.disableAIFeatures': true }, { reload: true });

		await app.workbench.hotKeys.openCommandPalette();
		await app.workbench.quickInput.type('>Chat: ');
		// With the category gated out, the picker falls back to fuzzy "similar
		// commands", so we can't rely on a "No matching commands" message. Wait for
		// the list to render, then assert no command is shown under "Chat".
		await app.workbench.quickInput.waitForQuickInputElementText();
		await expect(
			app.workbench.quickInput.quickInputResult.filter({ hasText: CHAT_CATEGORY_ROW })
		).toHaveCount(0);
		await app.workbench.quickInput.closeQuickInput();
	});

	test('Chat category is visible when AI features are enabled', async function ({ app, settings }) {
		await settings.set({ 'chat.disableAIFeatures': false }, { reload: true });

		await app.workbench.hotKeys.openCommandPalette();
		await app.workbench.quickInput.type('>Chat: ');
		await expect(
			app.workbench.quickInput.quickInputResult.filter({ hasText: CHAT_CATEGORY_ROW }).first()
		).toBeVisible({ timeout: 15000 });
		await app.workbench.quickInput.closeQuickInput();
	});
});
