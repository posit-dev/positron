/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.layouts.enterLayout('stacked');
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});

test.describe('Object Explorer - R', {
	tag: [tags.WEB, tags.WIN, tags.OBJECT_EXPLORER, tags.ARK]
}, () => {
	test('R - View() a model fit and show the accessor of a nested value', async function ({ app, r, executeCode }) {
		const { objectExplorer, editors } = app.workbench;

		await executeCode('R', 'fit <- lm(mpg ~ wt, mtcars)');
		await executeCode('R', 'View(fit)', { maximizeConsole: false });
		await editors.verifyTab('Object: fit', { isVisible: true, isSelected: true });

		await objectExplorer.expandRow('coefficients');
		await objectExplorer.selectRow('wt');
		await objectExplorer.expectStatus('fit[["coefficients"]][["wt"]]');
	});
});
