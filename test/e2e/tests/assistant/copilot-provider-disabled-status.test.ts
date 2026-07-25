/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';
import { ProvidersFile } from '../../pages/utils/providersFile';

test.use({
	suiteId: __filename
});

/**
 * When the GitHub Copilot provider is turned off
 * (`providers.copilot.enabled: false` in providers.json), Copilot chat and inline
 * completions are both off, so the chat status bar entry shows the "Copilot disabled"
 * state (the `$(copilot-unavailable)` icon) rather than a sign-in / setup state, which
 * would be misleading. This guards the disabled-state branch in chatStatusEntry.ts.
 *
 * Enablement lives in the provider catalog now; with no providers.json every provider
 * is enabled by default. The entry re-reads the catalog live (no reload needed -- see
 * the onDidChangeProviders listener in chatStatusEntry.ts), so the test writes
 * providers.json to disable Copilot and watches the state flip.
 */

const COPILOT_PROVIDER = 'copilot';
const STATUS_ITEM = '.statusbar-item[id="chat.statusBarEntry"]';
// The disabled state renders the copilot-unavailable codicon; a stable, state-specific marker.
const DISABLED_ICON = `${STATUS_ITEM} .codicon-copilot-unavailable`;

test.describe('Assistant: Copilot status reflects the provider setting', { tag: [tags.ASSISTANT] }, () => {

	const providers = new ProvidersFile();

	test.afterEach(async () => {
		// Restore the default (every provider is enabled when providers.json is absent).
		await providers.delete();
	});

	test('Shows the "Copilot disabled" state when the Copilot provider is off', async function ({ page, openFile }) {
		// Open a file so the editor-mode status area (which the chat entry anchors to) is present.
		await openFile('workspaces/generate-data-frames-r/simple-data-frames.r');

		// Baseline: the entry is present and not in the disabled state (provider on by default).
		await expect(page.locator(STATUS_ITEM)).toBeVisible();
		await expect(page.locator(DISABLED_ICON)).toHaveCount(0);

		// Turn the provider off. The catalog watches providers.json, so the entry reads this live.
		await providers.setEnabled(COPILOT_PROVIDER, false);

		await expect(page.locator(DISABLED_ICON)).toBeVisible();
	});
});
