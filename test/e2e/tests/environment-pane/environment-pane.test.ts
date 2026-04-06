/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Environment Pane', {
	tag: [tags.WEB, tags.WIN, tags.PACKAGES_PANE]
}, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'positron.environments.enable': true
		}, { reload: 'web' });
	});

	test('Python - Click packages button', async function ({ app, python }) {
		const { packages } = app.workbench;

		await packages.open();
		await packages.expectPackageCountGreaterThan(0);
		await packages.expectSessionLabelToContain(process.env.POSITRON_PY_VER_SEL!);
	});

	test('R - Click packages button', async function ({ app, r }) {
		const { packages } = app.workbench;

		await packages.open();
		await packages.expectPackageCountGreaterThan(0);
		await packages.expectSessionLabelToContain(process.env.POSITRON_R_VER_SEL!);
	});
});
