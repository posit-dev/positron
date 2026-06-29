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

// A small, real package available on both PyPI and CRAN whose import/library
// name matches its distribution name, and that is not installed in the default
// test environments.
const MISSING_PACKAGE = 'cowsay';

test.describe('Install Missing Packages', {
	tag: [tags.PACKAGES_PANE, tags.CONSOLE]
}, () => {

	// Set by each test to the language it installed the package into, so the
	// afterEach can remove it. Leaving the package installed would hide the
	// "missing" state the analyzer looks for and break reruns.
	let installedIn: 'Python' | 'R' | undefined;

	test.afterEach(async function ({ app, hotKeys }) {
		const { console, packages } = app.workbench;
		if (installedIn === 'Python') {
			await console.executeCode('Python', `%pip uninstall -y ${MISSING_PACKAGE}`);
		} else if (installedIn === 'R') {
			await console.executeCode('R', `remove.packages("${MISSING_PACKAGE}")`);
		}
		installedIn = undefined;
		await packages.closePackagesPane();
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
			installedIn = 'Python';
			await page.getByText(`Install ${MISSING_PACKAGE}`, { exact: true }).click();
			// The install runs via the package manager; confirm it lands by
			// finding it in the Packages pane.
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});
	});

	test('Command - Install Missing Packages installs a referenced Python package', async function ({ app, python, openFile }) {
		const { packages, quickaccess } = app.workbench;
		const fileName = 'missing_packages_install.py';
		const filePath = join(app.workspacePathOrFolder, fileName);

		await test.step('Open a Python file that references a missing package', async () => {
			await fs.writeFile(filePath, `import ${MISSING_PACKAGE}\n`);
			await openFile(fileName);
		});

		await test.step('The Install Missing Packages command installs the package', async () => {
			installedIn = 'Python';
			// The command blocks on the analysis (unlike the ambient badge/preflight),
			// so there is no cache-warmth race to wait on.
			await quickaccess.runCommand('Install Missing Packages');
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});

		await fs.rm(filePath, { force: true });
	});

	test('Command - Install Missing Packages installs a referenced R package', async function ({ app, r, openFile }) {
		const { packages, quickaccess } = app.workbench;
		const fileName = 'missing_packages_install.R';
		const filePath = join(app.workspacePathOrFolder, fileName);

		await test.step('Open an R file that references a missing package', async () => {
			await fs.writeFile(filePath, `library(${MISSING_PACKAGE})\n`);
			await openFile(fileName);
		});

		await test.step('The Install Missing Packages command installs the package', async () => {
			installedIn = 'R';
			await quickaccess.runCommand('Install Missing Packages');
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});

		await fs.rm(filePath, { force: true });
	});

	test('Command - Check for Missing Packages prompts before installing', async function ({ app, python, openFile }) {
		const { packages, quickaccess } = app.workbench;
		const page = app.code.driver.currentPage;
		const fileName = 'missing_packages_check.py';
		const filePath = join(app.workspacePathOrFolder, fileName);

		await test.step('Open a Python file that references a missing package', async () => {
			await fs.writeFile(filePath, `import ${MISSING_PACKAGE}\n`);
			await openFile(fileName);
		});

		await test.step('The Check command shows a modal naming the missing package', async () => {
			await quickaccess.runCommand('Check for Missing Packages');
			await expect(page.getByText('Install Missing Packages')).toBeVisible({ timeout: 30000 });
			// The install button names the package, confirming the analysis ran.
			await expect(page.getByText(`Install '${MISSING_PACKAGE}'`, { exact: true })).toBeVisible();
		});

		await test.step('Confirming the modal installs the package', async () => {
			installedIn = 'Python';
			await page.getByText(`Install '${MISSING_PACKAGE}'`, { exact: true }).click();
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});

		await fs.rm(filePath, { force: true });
	});
});
