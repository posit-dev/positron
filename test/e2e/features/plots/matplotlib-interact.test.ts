/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({
	suiteId: __filename
});

test.describe('Matplotlib Interact', { tag: ['@plots', '@notebook'] }, () => {

	test('Python - Matplotlib Interact Test [C1067443]', {
		tag: ['@pr', '@web', '@win'],
	}, async function ({ app, python }) {

		const notebooks = app.workbench.positronNotebooks;

		await app.workbench.positronQuickaccess.openDataFile(join(app.workspacePathOrFolder, 'workspaces', 'matplotlib', 'interact.ipynb'));

		await notebooks.selectInterpreter('Python Environments', process.env.POSITRON_PY_VER_SEL!);

		await notebooks.runAllCells();

		await app.workbench.quickaccess.runCommand('workbench.action.togglePanel');

		const plotLocator = app.workbench.positronNotebooks.frameLocator.locator('.widget-output');

		const plotImageLocator = plotLocator.locator('img');

		const imgSrcBefore = await plotImageLocator.getAttribute('src');

		const sliders = await app.workbench.positronNotebooks.frameLocator.locator('.slider-container .slider').all();

		for (const slider of sliders) {
			await slider.hover();
			await slider.click();
		}

		const imgSrcAfter = await plotImageLocator.getAttribute('src');

		expect(imgSrcBefore).not.toBe(imgSrcAfter);

	});

});
