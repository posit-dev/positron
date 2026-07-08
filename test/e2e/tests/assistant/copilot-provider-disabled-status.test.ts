/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

/**
 * When the GitHub Copilot provider is turned off
 * (`positron.assistant.provider.githubCopilot.enable: false`), Copilot chat and inline
 * completions are both off, so the chat status bar entry shows the "Copilot disabled"
 * state (the `$(copilot-unavailable)` icon) rather than a sign-in / setup state, which
 * would be misleading. This guards the disabled-state branch in chatStatusEntry.ts.
 *
 * The e2e fixture enables the provider by default, and the entry re-reads the setting
 * live (no reload needed -- see the onDidChangeConfiguration listener in
 * chatStatusEntry.ts), so the test just toggles the setting and watches the state flip.
 */

const PROVIDER_SETTING = 'positron.assistant.provider.githubCopilot.enable';
const STATUS_ITEM = '.statusbar-item[id="chat.statusBarEntry"]';
// The disabled state renders the copilot-unavailable codicon; a stable, state-specific marker.
const DISABLED_ICON = `${STATUS_ITEM} .codicon-copilot-unavailable`;

test.describe('Assistant: Copilot status reflects the provider setting', { tag: [tags.ASSISTANT, tags.WEB] }, () => {

	test.afterEach(async ({ settings }) => {
		// Restore the fixture default (the provider is enabled by default).
		await settings.set({ [PROVIDER_SETTING]: true });
	});

	test('Shows the "Copilot disabled" state when the Copilot provider is off', async function ({ page, settings, openFile }) {
		// Open a file so the editor-mode status area (which the chat entry anchors to) is present.
		await openFile('workspaces/generate-data-frames-r/simple-data-frames.r');

		// Baseline: the entry is present and not in the disabled state (provider on by default).
		await expect(page.locator(STATUS_ITEM)).toBeVisible();
		await expect(page.locator(DISABLED_ICON)).toHaveCount(0);

		// Turn the provider off. The entry reads this live, no reload.
		await settings.set({ [PROVIDER_SETTING]: false });

		await expect(page.locator(DISABLED_ICON)).toBeVisible();
	});
});
