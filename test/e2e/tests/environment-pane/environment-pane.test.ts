/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

// mouse scroll doesn't work in web
// https://github.com/posit-dev/positron/issues/12964
test.describe('Environment Pane', {
	tag: [tags.WIN, tags.PACKAGES_PANE]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.environments.enable': true
		}, { reload: 'web' });
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.packages.closePackagesPane();
	});

	test('Python - Click packages button', async function ({ app, python: _python }) {
		const { packages } = app.workbench;

		await packages.verifyPackagesList();
		await packages.installPackage('cowsay');

		const allPackages = await packages.getAllPackages();
		expect(allPackages).toContain('cowsay');
	});

	test('R - Click packages button', async function ({ app, r: _r }) {
		const { packages } = app.workbench;

		await packages.verifyPackagesList();
		await packages.installPackage('cowsay');

		const allPackages = await packages.getAllPackages();
		expect(allPackages).toContain('cowsay');
	});
});
