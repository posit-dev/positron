/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables: Memory Usage', {
	tag: [tags.WEB, tags.WIN, tags.VARIABLES, tags.SESSIONS]
}, () => {

	test.beforeEach(async function ({ hotKeys }) {
		await hotKeys.closeSecondarySidebar();
	});

	test.afterEach(async function ({ sessions }) {
		await sessions.deleteDisconnectedSessions();
	});

	test('Shut-down session is removed from memory usage meter', async function ({ app, page, sessions, settings }) {
		const { console, variables } = app.workbench;

		// Set a fast polling interval so the memory meter updates quickly
		await settings.set({ 'positron.memoryUsage.pollingIntervalMs': 1000 });

		// Start two sessions
		const [pySession, rSession] = await sessions.start(['python', 'r']);

		// Focus variables view so the memory meter is visible
		await variables.focusVariablesView();

		// Wait for the memory meter to appear with a real value (not loading)
		const memoryMeter = page.locator('.memory-usage-meter');
		await expect(memoryMeter).toBeVisible({ timeout: 30000 });
		await expect(memoryMeter.locator('.memory-size-label')).not.toHaveText('Mem', { timeout: 30000 });

		// Click the memory meter to open the dropdown
		await memoryMeter.click();

		// Verify both sessions appear in the dropdown
		const dropdown = page.locator('.memory-usage-dropdown');
		await expect(dropdown).toBeVisible({ timeout: 15000 });
		await expect(dropdown.locator('.usage-name').filter({ hasText: pySession.name })).toBeVisible();
		await expect(dropdown.locator('.usage-name').filter({ hasText: rSession.name })).toBeVisible();

		// Close the dropdown by pressing Escape
		await page.keyboard.press('Escape');
		await expect(dropdown).not.toBeVisible();

		// Shut down the Python session (not delete)
		await sessions.select(pySession.name);
		await console.typeToConsole('exit()', true);
		await sessions.expectSessionCountToBe(1, 'active');

		// Switch to the R session so the variables pane is active
		await sessions.select(rSession.name);
		await variables.focusVariablesView();

		// Open the memory meter dropdown again
		await expect(memoryMeter).toBeVisible({ timeout: 15000 });
		await memoryMeter.click();
		await expect(dropdown).toBeVisible({ timeout: 15000 });

		// Verify the shut-down Python session is no longer listed
		await expect(dropdown.locator('.usage-name').filter({ hasText: pySession.name })).not.toBeVisible({ timeout: 15000 });

		// Verify the active R session is still listed
		await expect(dropdown.locator('.usage-name').filter({ hasText: rSession.name })).toBeVisible();

		// Close the dropdown
		await page.keyboard.press('Escape');
	});
});
