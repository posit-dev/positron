/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.layouts.enterLayout('stacked');
});

test.afterEach(async function ({ hotKeys }) {
	await hotKeys.closeAllEditors();
});

test.describe('Object Explorer - Python', {
	tag: [tags.WEB, tags.WIN, tags.OBJECT_EXPLORER]
}, () => {
	test('Python - Explore, search, and follow a dict', async function ({ app, python, executeCode }) {
		const { objectExplorer, editors, variables } = app.workbench;

		await executeCode('Python', 'd = {"alpha": {"beta": [1, "needle", {"gamma": "needle"}]}, "delta": "haystack"}');
		await variables.focusVariablesView();
		await variables.doubleClickVariableRow('d');
		await editors.verifyTab('Object: d', { isVisible: true, isSelected: true });

		await test.step('Expand and select a nested node', async () => {
			await objectExplorer.expectRow('delta', { type: 'str', value: "'haystack'" });
			await objectExplorer.expandRow('alpha');
			await objectExplorer.selectRow('beta');
			await objectExplorer.expectStatus(`d['alpha']['beta']`);
		});

		await test.step('Search shows the matches and their ancestors', async () => {
			await objectExplorer.search('needle');
			await objectExplorer.expectMatches(['needle', 'needle']);
			await objectExplorer.expectRow('gamma');
			await objectExplorer.clearSearch();
			await objectExplorer.expectRow('delta');
		});

		await test.step('Reassigning the variable updates the explorer', async () => {
			await executeCode('Python', 'd = {"alpha": 1, "delta": "changed"}', { maximizeConsole: false });
			await objectExplorer.expectRow('delta', { value: "'changed'" });
		});

		await test.step('Deleting the variable closes the explorer', async () => {
			await executeCode('Python', 'del d', { maximizeConsole: false });
			await expect(objectExplorer.closedNotice).toBeVisible();
		});
	});
});
