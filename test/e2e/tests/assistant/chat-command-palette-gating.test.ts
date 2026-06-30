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
 * when AI features are turned off by either switch: Copilot's own
 * `chat.disableAIFeatures`, or Positron's `ai.enabled` main switch.
 *
 * Chat command preconditions (core and the Copilot extension's `commandPalette`
 * entries) gate on the `chatAiFeaturesEnabled` context key, which `ChatAgentService`
 * keeps in sync from both settings. A command's precondition gates its command
 * palette visibility, and the palette renders these commands with a "Chat: " prefix
 * (see commandsQuickAccess.ts "commandWithCategory").
 *
 * Both switches are covered: an earlier version only flipped `chat.disableAIFeatures`,
 * so an `ai.enabled = false` regression (commands still showing) went uncaught.
 *
 * The e2e settings fixture enables Positron Assistant (`positron.assistant.enable`),
 * which registers the default chat participant, so chat is "enabled" by default and
 * the "Chat" category is shown until AI features are explicitly turned off.
 *
 * @see https://github.com/posit-dev/positron/pull/14054 (single-command gating this extends)
 */
test.describe('Chat Command Palette Gating', { tag: [tags.ASSISTANT, tags.POSIT_ASSISTANT] }, () => {
	// Command palette rows in the "Chat" category render as "Chat: <title>".
	// Anchor at the start so other categories (e.g. "GitHub Copilot Chat: ...") are excluded.
	const CHAT_CATEGORY_ROW = /^Chat: /;

	test.afterEach('Reset AI switch settings', async function ({ settings }) {
		await settings.remove(['chat.disableAIFeatures', 'ai.enabled']);
	});

	// Each switch must hide the Chat category on its own, with the *other*
	// switch left in its AI-on position. The `ai.enabled` row is the reported bug:
	// `chat.disableAIFeatures` is false yet AI is still off via the main switch.
	const offCases = [
		{ name: 'chat.disableAIFeatures is on', config: { 'chat.disableAIFeatures': true, 'ai.enabled': true } },
		{ name: 'the ai.enabled main switch is off', config: { 'chat.disableAIFeatures': false, 'ai.enabled': false } },
		{ name: 'both switches are off', config: { 'chat.disableAIFeatures': true, 'ai.enabled': false } },
	];
	for (const { name, config } of offCases) {
		test(`Chat category is hidden when ${name}`, async function ({ app, settings }) {
			await settings.set(config, { reload: true });

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
	}

	test('Chat category is visible when AI features are enabled', async function ({ app, settings }) {
		await settings.set({ 'chat.disableAIFeatures': false, 'ai.enabled': true }, { reload: true });

		await app.workbench.hotKeys.openCommandPalette();
		await app.workbench.quickInput.type('>Chat: ');
		await expect(
			app.workbench.quickInput.quickInputResult.filter({ hasText: CHAT_CATEGORY_ROW }).first()
		).toBeVisible({ timeout: 15000 });
		await app.workbench.quickInput.closeQuickInput();
	});
});
