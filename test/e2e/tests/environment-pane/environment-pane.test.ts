/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Environment Pane', {
	tag: [tags.WIN, tags.PACKAGES_PANE, tags.WEB]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.packages.enable': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.packages.closePackagesPane();
	});

	test('Python - Install and search package', async function ({ app, python: _python }) {
		const { packages } = app.workbench;

		await packages.verifyPackagesList();

		// install package and verify it shows up in the list
		await packages.installPackage('cowsay');
		await packages.searchPackages('cowsay');
		await packages.expectPackageInList('cowsay');
	});

	test('R - Install and search package', async function ({ app, r: _r }) {
		const { packages } = app.workbench;

		await packages.verifyPackagesList();

		// install package and verify it shows up in the list
		await packages.installPackage('cowsay');
		await packages.searchPackages('cowsay');
		await packages.expectPackageInList('cowsay');
	});
});
