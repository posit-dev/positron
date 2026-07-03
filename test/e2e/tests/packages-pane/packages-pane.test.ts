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

	test.describe('Python - Install, search, and uninstall package', () => {
		test.beforeAll(async function ({ app, openFolder }) {
			await openFolder('qa-example-content/workspaces/packages-pane-python');
		});

		pythonRuntimes.forEach((runtime) => {
			test(`Python - Install, search, and uninstall package (${runtime})`, { tag: [tags.WIN] },
				async function ({ app, sessions }) {
					const { packages, toasts, console, terminal } = app.workbench;

					await sessions.start(runtime);

					await packages.verifyPackagesList();

					// install package and verify it shows up in the list
					await packages.installPackage('cowsay');
					await packages.searchPackages('cowsay');
					// --- TEMP DIAGNOSTIC (remove before merge): CI fails here for uv only. ---
					try {
						await packages.expectPackageInList('cowsay');
					} catch (originalError) {
						const diag: string[] = [];
						// (1) List-refresh hypothesis: does an explicit refresh surface it?
						let afterRefresh = 'unknown';
						try {
							await packages.clickRefreshPackagesButton();
							await packages.searchPackages('cowsay');
							await packages.expectPackageInList('cowsay', 15_000);
							afterRefresh = 'VISIBLE_AFTER_REFRESH';
						} catch {
							afterRefresh = 'STILL_ABSENT_AFTER_REFRESH';
						}
						diag.push(`refresh=${afterRefresh}`);
						// (2) Install hypothesis: is cowsay actually importable in the session?
						let importable = 'unknown';
						try {
							await console.executeCode('Python',
								'import importlib.util as _u; print("COWSAY_SPEC=" + str(_u.find_spec("cowsay") is not None))');
							try {
								await console.waitForConsoleContents('COWSAY_SPEC=True', { timeout: 10_000 });
								importable = 'IMPORTABLE_TRUE';
							} catch {
								importable = 'IMPORTABLE_FALSE_OR_TIMEOUT';
							}
						} catch (e) {
							importable = `probe_failed:${(e as Error).message?.slice(0, 80)}`;
						}
						diag.push(`import=${importable}`);
						// (3) Capture terminal contents (uv install output, if any).
						try {
							await terminal.logTerminalContents();
						} catch { /* best effort */ }
						throw new Error(`[DIAG runtime=${runtime}] ${diag.join(' ')} :: ${(originalError as Error).message}`);
					}
					// --- END TEMP DIAGNOSTIC ---

					// uninstall package and verify it is removed from the list
					await packages.uninstallPackage('cowsay');
					await packages.expectPackageNotInList('cowsay');

					await toasts.closeAll();
				});
		});
	});

	test('R - Install, search, and uninstall package', {
		tag: [tags.WIN]
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
		test('R - Opens package help in Help pane', async function ({ app, r: _r }) {
			const { packages } = app.workbench;

			// Base is always attached
			await packages.clickHelpButton('base');
			await packages.expectHelpPaneToContainText('The R Base Package');
		});

		test('Python - Opens package help in Help pane', { tag: [tags.WEB] },
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
		test('Python - Shows external link for a package with a homepage', { tag: [tags.WEB] },
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
