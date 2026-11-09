/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test as base, tags, expect } from '../_test.setup';
import { SessionRuntimes } from '../../pages/sessions.js';

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

test.describe('Packages Pane', {
	tag: [tags.PACKAGES_PANE, tags.WEB]
}, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.packages.clearFilter();
		await app.workbench.packages.closePackagesPane();
		// The Python package manager runs in the terminal, leaving it focused.
		// Click the console label to take focus off the terminal so the next
		// iteration's console.focus() (Cmd+K F) chord resolves instead of leaking
		// 'F' into the terminal and corrupting the next install.
		await app.workbench.console.clickConsoleLabel();
	});

	// python is uv; pythonAlt is pyenv
	const pythonRuntimes: SessionRuntimes[] = ['python', 'pythonAlt'];

	test.describe('Python - Install, search, and uninstall package', { tag: [tags.PYTHON] }, () => {
		test.beforeAll(async function ({ app, openFolder }) {
			await openFolder('test-files/workspaces/packages-pane-python');
		});

		pythonRuntimes.forEach((runtime) => {
			test.skip(`Python - Install, search, and uninstall package (${runtime})`, {
				tag: [tags.WIN],
				annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/15714' }]
			}, async function ({ app, sessions }) {
				const { packages, toasts } = app.workbench;

				await sessions.start(runtime);

				await packages.verifyPackagesList();

				// install package and verify it shows up in the list
				await packages.installPackage('cowsay');
				await packages.searchPackages('cowsay');
				await packages.expectPackageInList('cowsay');

				// uninstall package and verify it is removed from the list
				await packages.uninstallPackage('cowsay');
				await packages.expectPackageNotInList('cowsay');

				await toasts.closeAll();
			});
		});
	});

	test.describe('Python - Update and uninstall multiple packages', { tag: [tags.PYTHON] }, () => {
		test.beforeAll(async function ({ openFolder }) {
			await openFolder('test-files/workspaces/packages-pane-python');
		});

		test('Python - Update and uninstall multiple selected packages', async function ({ app, python: _python }) {
			const { packages, toasts } = app.workbench;

			// colorama and colorlog are small pure-Python wheels with no dependencies here, and
			// their names share a prefix, so one filter keeps both rows on screen to multi-select.
			// Each is pinned to an old release, so both show as outdated. Pick names the package
			// metadata already spells in canonical form: a name like `tomli_w` is never matched
			// against the package manager's outdated list, so its row never offers an update.
			const oldVersions = { 'colorama': '0.4.4', 'colorlog': '6.7.0' };
			const names = Object.keys(oldVersions);

			await test.step('Install old versions of both packages', async () => {
				await packages.verifyPackagesList();
				for (const [name, version] of Object.entries(oldVersions)) {
					await packages.installPackage(name, { version });
				}
				await packages.searchPackages('color');
				for (const [name, version] of Object.entries(oldVersions)) {
					await packages.expectPackageVersion(name, version);
				}
				// Update skips a package until the runtime has reported it as outdated.
				for (const name of names) {
					await packages.expectUpdateAvailable(name);
				}
			});

			await test.step('Update both from one multi-selection', async () => {
				await packages.selectPackages(names);
				await packages.updateSelectedPackages('colorama');
				for (const [name, version] of Object.entries(oldVersions)) {
					await packages.expectPackageVersionChanged(name, version);
				}
			});

			// The update refreshes the list and re-versions both rows. Uninstalling without
			// selecting again proves the selection followed the packages through the refresh.
			await test.step('Uninstall both from the same selection', async () => {
				await packages.expectPackagesSelected(names);
				await packages.uninstallSelectedPackages('colorama');
				for (const name of names) {
					await packages.expectPackageNotInList(name);
				}
			});

			await toasts.closeAll();
		});
	});

	test('R - Install, search, and uninstall package', {
		tag: [tags.WIN, tags.ARK]
	},
		async function ({ app, r: _r }) {
			const { packages } = app.workbench;

			await packages.verifyPackagesList();

			// install package and verify it shows up in the list
			await packages.installPackage('cowsay');
			await packages.searchPackages('cowsay');
			await packages.expectPackageInList('cowsay');

			// uninstall package and verify it is removed from the list
			await packages.uninstallPackage('cowsay');
			await packages.expectPackageNotInList('cowsay');
		});

	test.describe('Help button', { tag: [tags.HELP] }, () => {
		test.beforeAll(async function ({ runCommand }) {
			// Session tabs render at the right edge of the console pane, in the same band
			// where notification toasts stack upward from the bottom of the window. The
			// package install/uninstall tests above raise those toasts, so maximize the
			// panel to lift the tabs clear of them.
			await runCommand('workbench.action.maximizePanel');
		});

		test('R - Opens package help in Help pane', { tag: [tags.ARK] }, async function ({ app, r: _r }) {
			const { packages } = app.workbench;

			// Base is always attached
			await packages.clickHelpButton('base');
			await packages.expectHelpPaneToContainText('The R Base Package');
		});

		test('Python - Opens package help in Help pane', { tag: [tags.WEB, tags.PYTHON] },
			async function ({ app, python: _python, executeCode }) {
				const { packages } = app.workbench;

				// `attached` is true only when the user has bound the module in the REPL and refreshed
				await executeCode('Python', 'import numpy');
				await packages.clickRefreshPackagesButton();

				await packages.clickHelpButton('numpy');
				await packages.expectHelpPaneToContainText('NumPy');
			});
	});

	test.describe('URL button', () => {
		test('Python - Shows external link for a package with a homepage', { tag: [tags.WEB, tags.PYTHON] },
			async function ({ app, python: _python }) {
				const { packages } = app.workbench;

				// numpy publishes a `Project-URL: Homepage` in its wheel metadata,
				// so the kernel surfaces a `url` and the row renders the link button.
				await packages.verifyPackagesList();
				await packages.searchPackages('numpy');
				await expect(packages.urlButton('numpy')).toBeVisible();
			});
	});
});
