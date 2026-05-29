/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Packages Pane', {
	tag: [tags.PACKAGES_PANE, tags.WEB]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'packages.enabled': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.packages.clearFilter();
		await app.workbench.packages.closePackagesPane();
	});

	test('Python - Install and search package', { tag: [tags.WIN] },
		async function ({ app, python: _python }) {
			const { packages } = app.workbench;

			await packages.verifyPackagesList();

			// install package and verify it shows up in the list
			await packages.installPackage('cowsay');
			await packages.searchPackages('cowsay');
			await packages.expectPackageInList('cowsay');
		});

	test('R - Install and search package', { tag: [tags.WIN] },
		async function ({ app, r: _r }) {
			const { packages } = app.workbench;

			await packages.verifyPackagesList();

			// install package and verify it shows up in the list
			await packages.installPackage('cowsay');
			await packages.searchPackages('cowsay');
			await packages.expectPackageInList('cowsay');
		});

	test.describe('Help button', { tag: [tags.HELP] }, () => {
		test('R - Opens package help in Help pane', { tag: [tags.WIN] }, async function ({ app, r: _r }) {
			const { packages } = app.workbench;

			// Base is always attached
			await packages.clickHelpButton('base');
			await packages.expectHelpPaneToContainText('The R Base Package', 0);
		});

		test('Python - Opens package help in Help pane', { tag: [tags.WEB] },
			async function ({ app, python: _python, executeCode }) {
				const { packages } = app.workbench;

				// `attached` is true only when the user has bound the module in the REPL and refreshed
				await executeCode('Python', 'import numpy');
				await packages.clickRefreshPackagesButton();

				await packages.clickHelpButton('numpy');
				await packages.expectHelpPaneToContainText('NumPy', 1);
			});
	});
});
