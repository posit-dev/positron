/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// TO RUN THIS TEST:
// remove this line of code from playwright.config.ts: `testIgnore: '**/example.test.ts`

// we must import test from _test.setup to ensure we have the correct test
// context which enables our custom fixtures
import { test } from './_test.setup';
import { _electronApp } from '../infra/playwrightElectron.js';
import { expect } from '@playwright/test';

// we need this to ensure each spec gets a fresh app instance read more here:
// https://positpbc.atlassian.net/wiki/spaces/POSITRON/pages/1224999131/Proof+of+Concept+Playwright#SuiteId
test.use({
	suiteId: __filename
});


test.describe('Context Menu Tests', { tag: [] }, () => {
	test("Context Menu Open Bash", async function ({ app, page }) {
		await app.workbench.terminal.clickTerminalTab();
		const button = page.getByLabel('Launch Profile...');
		const menuResult = await app.showContextMenu(() => button.click());
		if (menuResult) {
			app.selectContextMenuItem(menuResult.menuId, 'bash');
			expect(page.getByLabel('$(terminal-bash) bash')).toBeVisible();
		}
	});

	test("Context Menu Fail Open Bash", async function ({ app, page }) {
		await app.workbench.terminal.clickTerminalTab();
		const button = page.getByLabel('Launch Profile...');
		const menuResult = await app.showContextMenu(() => button.click());
		if (menuResult) {
			app.selectContextMenuItem(menuResult.menuId, 'zsh');
		}
		expect(page.getByLabel('$(terminal-bash) bash')).toBeVisible();
	});
});
