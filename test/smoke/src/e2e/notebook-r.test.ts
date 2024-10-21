/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';

import { PositronRFixtures } from '../../../automation';
import { test } from './test.setup';


test.describe('R Notebooks', {
	tag: ['@pr', '@win', '@web']
}, () => {

	test.beforeAll(async function ({ app }) {
		await PositronRFixtures.SetupFixtures(app);
	});

	test.beforeEach(async function ({ app }) {
		await app.workbench.positronNotebooks.createNewNotebook();
		await app.workbench.positronNotebooks.selectInterpreter('R Environments', process.env.POSITRON_R_VER_SEL!);
	});

	test.afterEach(async function ({ app }) {
		await app.workbench.positronNotebooks.closeNotebookWithoutSaving();
	});

	test('R - Basic notebook creation and execution (code) [C628629]', {
		annotation: {
			type: 'issue',
			description: 'http://www.google.com',
		}

	}, async function ({ app }) {
		await app.workbench.positronNotebooks.addCodeToFirstCell('eval(parse(text="8**2"))');

		await expect(async () => {
			await app.workbench.positronNotebooks.executeCodeInCell();
			expect(await app.workbench.positronNotebooks.getRCellOutput()).toBe('[1] 64');
		}).toPass({ timeout: 60000 });

	});

	test('R - Basic notebook creation and execution (markdown) [C628630]', async function ({ app }) {
		const randomText = Math.random().toString(36).substring(7);

		await app.workbench.notebook.insertNotebookCell('markdown');
		await app.workbench.notebook.waitForTypeInEditor(`## ${randomText} `);
		await app.workbench.notebook.stopEditingCell();

		expect(await app.workbench.positronNotebooks.getMarkdownText(`h2 >> text="${randomText}"`)).toBe(randomText);

	});
});
