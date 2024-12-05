/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../automation';
import { test, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer - Sparklines', {
	tag: ['@web', '@win']
}, () => {

	test.beforeEach(async function ({ app }) {
		await app.workbench.positronLayouts.enterLayout('stacked');
	});

	test.afterEach(async ({ app }) => {
		await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors', { keepOpen: false });
	});

	test('Python Pandas - Verifies downward trending graph [C830552]', async ({ app, python }) => {
		await app.workbench.positronConsole.executeCode('Python', pythonScript, '>>>');
		await openDataExplorerColumnProfile(app, 'pythonData');
		await verifyGraphBarHeights(app);
	});


	test('R - Verifies downward trending graph [C830553]', async ({ app, r }) => {
		await app.workbench.positronConsole.executeCode('R', rScript, '>');
		await openDataExplorerColumnProfile(app, 'rData');
		await verifyGraphBarHeights(app);
	});
});

async function openDataExplorerColumnProfile(app: Application, variableName: string) {

	await expect(async () => {
		await app.workbench.positronVariables.doubleClickVariableRow(variableName);
		await app.code.driver.getLocator(`.label-name:has-text("Data: ${variableName}")`).innerText();
	}).toPass();

	await app.workbench.quickaccess.runCommand('workbench.action.toggleSidebarVisibility');
	await app.workbench.positronSideBar.closeSecondarySideBar();
	await app.workbench.positronDataExplorer.getDataExplorerTableData();
	await app.workbench.positronDataExplorer.expandColumnProfile(0);
}

async function verifyGraphBarHeights(app: Application) {
	// Get all graph graph bars/rectangles
	await expect(async () => {
		const rects = app.code.driver.getLocator('rect.count');

		// Iterate over each rect and verify the height
		const expectedHeights = ['50', '40', '30', '20', '10'];
		for (let i = 0; i < expectedHeights.length; i++) {
			const height = await rects.nth(i).getAttribute('height');
			expect(height).toBe(expectedHeights[i]);
		}
	}).toPass({ timeout: 10000 });
}


const rScript = `library(dplyr)

rData <- tibble(
category = c("A", "A", "A", "A", "B", "B", "B", "C", "C", "D", "E", "A", "B", "C", "D"),
values = c(1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6)
)`;


const pythonScript = `import pandas as pd
import matplotlib.pyplot as plt

pythonData = pd.DataFrame({
'category': ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'E', 'A', 'B', 'C', 'D'],
'values': [1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6]
})`;

