/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { join } from 'path';
import { Application } from '../../infra';
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

/**
 * Removes the package from a language's environment so a test starts from a
 * known "missing" state, regardless of how a previous (possibly crashed) run
 * left the shared interpreter. A leftover install would hide the very "missing"
 * state these tests exercise. Harmless when the package is already absent.
 */
async function ensurePackageMissing(app: Application, language: 'Python' | 'R'): Promise<void> {
	const code = language === 'Python'
		? `%pip uninstall -y ${MISSING_PACKAGE}`
		: `if (requireNamespace("${MISSING_PACKAGE}", quietly = TRUE)) { remove.packages("${MISSING_PACKAGE}") }`;
	await app.workbench.console.executeCode(language, code);
}

test.describe('Install Missing Packages', {
	tag: [tags.PACKAGES_PANE, tags.CONSOLE]
}, () => {

	// The language each test exercises, so the afterEach can remove the package
	// it installed and leave the shared interpreter clean for the next test.
	let testLanguage: 'Python' | 'R' | undefined;

	test.afterEach(async function ({ app, hotKeys }) {
		if (testLanguage) {
			await ensurePackageMissing(app, testLanguage);
		}
		testLanguage = undefined;
		await app.workbench.packages.closePackagesPane();
		await hotKeys.closeAllEditors();
	});

	test('Console - a missing-module error offers to install the package', async function ({ app, python }) {
		const { console, packages } = app.workbench;
		const page = app.code.driver.currentPage;
		testLanguage = 'Python';

		await test.step('Trigger a missing-module error', async () => {
			await ensurePackageMissing(app, 'Python');
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

	test('Command - Install Missing Packages installs a referenced Python package', async function ({ app, python, openFile }) {
		const { packages, quickaccess } = app.workbench;
		const page = app.code.driver.currentPage;
		const fileName = 'missing_packages_install.py';
		const filePath = join(app.workspacePathOrFolder, fileName);
		testLanguage = 'Python';

		await test.step('Open a Python file that references a missing package', async () => {
			await ensurePackageMissing(app, 'Python');
			await fs.writeFile(filePath, `import ${MISSING_PACKAGE}\n`);
			await openFile(fileName);
		});

		await test.step('The Install Missing Packages command installs the package', async () => {
			// Wait for the badge before invoking the command: it appears once the
			// analyzer has produced (and cached) the missing-package set, so the
			// command's blocking analysis then reads a warm cache instead of racing
			// the extension's background availability-index build on a cold session.
			await expect(page.getByTestId('missing-packages-badge')).toBeVisible({ timeout: 30000 });
			await quickaccess.runCommand('Install Missing Packages');
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});

		await fs.rm(filePath, { force: true });
	});

	test('Command - Install Missing Packages installs a referenced R package', async function ({ app, r, openFile }) {
		const { packages, quickaccess } = app.workbench;
		const page = app.code.driver.currentPage;
		const fileName = 'missing_packages_install.R';
		const filePath = join(app.workspacePathOrFolder, fileName);
		testLanguage = 'R';

		await test.step('Open an R file that references a missing package', async () => {
			await ensurePackageMissing(app, 'R');
			await fs.writeFile(filePath, `library(${MISSING_PACKAGE})\n`);
			await openFile(fileName);
		});

		await test.step('The Install Missing Packages command installs the package', async () => {
			await expect(page.getByTestId('missing-packages-badge')).toBeVisible({ timeout: 30000 });
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
		testLanguage = 'Python';

		await test.step('Open a Python file that references a missing package', async () => {
			await ensurePackageMissing(app, 'Python');
			// Distinct content from the install test: the missing-packages cache is
			// keyed on (session, content hash) and the session is reused across tests,
			// so identical content could return a stale result for this new file.
			await fs.writeFile(filePath, `import ${MISSING_PACKAGE}\nprint("check-cmd")\n`);
			await openFile(fileName);
		});

		await test.step('The Check command shows a modal offering to install the package', async () => {
			// Gate on the badge so the command's analysis reads a warm cache (see the
			// Python install test for why).
			await expect(page.getByTestId('missing-packages-badge')).toBeVisible({ timeout: 30000 });
			await quickaccess.runCommand('Check for Missing Packages');
			// The modal's install button names the package and exists only in the
			// modal, so its visibility confirms the prompt appeared. (A title match
			// would collide with the "Packages: Install Missing Packages" palette item.)
			await expect(page.getByText(`Install '${MISSING_PACKAGE}'`, { exact: true })).toBeVisible({ timeout: 30000 });
		});

		await test.step('Confirming the modal installs the package', async () => {
			await page.getByText(`Install '${MISSING_PACKAGE}'`, { exact: true }).click();
			await packages.searchPackages(MISSING_PACKAGE);
			await packages.expectPackageInList(MISSING_PACKAGE);
		});

		await fs.rm(filePath, { force: true });
	});
});
