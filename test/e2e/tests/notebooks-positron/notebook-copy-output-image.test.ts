/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Generates a simple matplotlib plot
const matplotlibPlotCode = `import matplotlib.pyplot as plt
plt.figure(figsize=(3, 2))
plt.plot([1, 2, 3], [1, 4, 9])
plt.show()`;

test.describe('Positron Notebooks: Copy Output Image', {
	tag: [tags.POSITRON_NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test.beforeEach(async function ({ app, python }) {
		const { notebooks, notebooksPositron } = app.workbench;
		await app.workbench.layouts.enterLayout('notebook');
		await notebooks.createNewNotebook();
		await notebooksPositron.expectToBeVisible();
		await notebooksPositron.kernel.select('Python');
	});

	test('Copy Image appears in output ellipsis menu for plot output', async function ({ app, headless }) {
		test.skip(!!headless, 'Clipboard image tests require headed mode');

		const { notebooksPositron, contextMenu } = app.workbench;

		await test.step('Execute cell that generates a plot', async () => {
			await notebooksPositron.addCodeToCell(0, matplotlibPlotCode, { run: true, waitForSpinner: true });
		});

		const cellOutput = notebooksPositron.cell.nth(0).getByTestId('cell-output');
		const ellipsisButton = notebooksPositron.cell.nth(0).getByRole('button', { name: 'Cell Output Actions' });

		await test.step('Verify plot image appears in output', async () => {
			await expect(cellOutput.locator('img')).toBeVisible();
		});

		await test.step('Verify Copy Image option exists in ellipsis menu', async () => {
			// Retry to handle timing: context keys may not be set on the first
			// attempt due to the React render cycle.
			await expect(async () => {
				await contextMenu.triggerAndVerifyMenuItems({
					menuTrigger: ellipsisButton,
					menuTriggerButton: 'left',
					menuItemStates: [{ label: 'Copy Image', visible: true }],
				});
			}).toPass({ timeout: 15000 });
		});

		await test.step('Click Copy Image and verify clipboard has image data', async () => {
			await app.workbench.clipboard.clearClipboard();

			await contextMenu.triggerAndClick({
				menuTrigger: ellipsisButton,
				menuTriggerButton: 'left',
				menuItemLabel: 'Copy Image',
			});

			await app.code.wait(500);

			const clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
			expect(clipboardImageBuffer).not.toBeNull();
		});
	});

});
