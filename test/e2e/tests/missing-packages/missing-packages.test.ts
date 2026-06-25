/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { join } from 'path';
import { test as base, expect, tags } from '../_test.setup';

// Enable the Packages pane (used to verify installs) before the app launches.
const test = base.extend<{}, {}>({
	beforeApp: [
		async ({ settingsFile }, use) => {
			await settingsFile.append({ 'packages.enabled': true });
			await use();
		},
		{ scope: 'worker' }
	],
});

test.use({
	suiteId: __filename
});

// A small, real PyPI package whose import name matches its distribution name,
// and that is not installed in the default test interpreter.
const MISSING_PACKAGE = 'cowsay';

test.describe('Install Missing Packages', {
	tag: [tags.PACKAGES_PANE, tags.CONSOLE]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		// Uninstall the package so each test (and reruns) start from a clean
		// state, then tidy up the UI.
		await app.workbench.console.executeCode('Python', `%pip uninstall -y ${MISSING_PACKAGE}`);
		await app.workbench.packages.closePackagesPane();
		await hotKeys.closeAllEditors();
	});

	test('Console - a missing-module error offers to install the package', async function ({ app, python }) {
		const { console, packages } = app.workbench;
		const page = app.code.driver.currentPage;

		await test.step('Trigger a missing-module error', async () => {
			await console.executeCode('Python', `import ${MISSING_PACKAGE}`);
			await expect(page.locator('.activity-error-message')).toBeVisible({ timeout: 30000 });
		});

		await test.step('A lightbulb suggestion to install the package appears beneath the error', async () => {
			// Rendered by ActivityErrorSuggestion: yellow gutter + "Install <pkg>" link.
			await expect(page.getByTestId('error-suggestion-bar')).toBeVisible({ timeout: 30000 });
			await expect(page.getByText(`Install ${MISSING_PACKAGE}`, { exact: true })).toBeVisible({ timeout: 30000 });
		});

		await test.step('Clicking the suggestion installs the package', async () => {
			await page.getByText(`Install ${MISSING_PACKAGE}`, { exact: true }).click();
			// The install runs via the package manager; confirm it lands by
			// finding it in the Packages pane.
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});
	});

	test('Run File - preflight offers to install missing packages then runs', async function ({ app, python, openFile }) {
		const { console, editor, packages } = app.workbench;
		const page = app.code.driver.currentPage;
		const fileName = 'missing_packages_preflight.py';
		const filePath = join(app.workspacePathOrFolder, fileName);

		await test.step('Open a Python file that references a missing package', async () => {
			await fs.writeFile(filePath, `import ${MISSING_PACKAGE}\nprint("preflight-ran")\n`);
			await openFile(fileName);
		});

		await test.step('The editor action bar warns that a package is missing', async () => {
			// The badge appearing also confirms the missing-package set is cached,
			// which is what lets the preflight read it synchronously on Run.
			await expect(page.getByTestId('missing-packages-badge')).toBeVisible({ timeout: 30000 });
		});

		await test.step('Running the file shows the preflight modal', async () => {
			await editor.pressPlay(true);
			await expect(page.getByText('Install Missing Packages')).toBeVisible({ timeout: 15000 });
		});

		await test.step('Choosing install-and-run installs the package and runs the file', async () => {
			await page.getByText('Install Packages and Run').click();
			// The package installs, then the file runs and prints its marker.
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
			await console.waitForConsoleContents('preflight-ran', { timeout: 120000 });
		});

		await fs.rm(filePath, { force: true });
	});
});
