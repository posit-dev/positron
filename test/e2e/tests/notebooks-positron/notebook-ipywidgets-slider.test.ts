/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({ suiteId: __filename });

test.describe('Positron Notebooks: ipywidgets', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeEach(async function ({ app }) {
		const { notebooks, notebooksPositron } = app.workbench;
		await notebooks.createNewNotebook();
		await notebooksPositron.expectCellCountToBe(1);
		await notebooksPositron.kernel.select('Python');
	});

	test.skip('IntSlider arrow keys change value', {
		annotation: { type: 'issue', description: 'https://github.com/posit-dev/positron/issues/13646' }
	}, async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		await notebooksPositron.addCodeToCell(0, `
import ipywidgets as ipw
s = ipw.IntSlider(value=50, min=0, max=100)
display(s)
`, { run: true });

		await expect(notebooksPositron.widgetSlider).toBeVisible({ timeout: 5000 });
		await notebooksPositron.focusWidgetSlider();

		// Moving from 50 to 49 proves widget interactivity
		await notebooksPositron.widgetSlider.press('ArrowLeft');
		await expect(notebooksPositron.widgetReadout).toContainText('49');

		// Moving from 49 to 51 proves that widget does NOT get stuck after first interactivity event.
		await notebooksPositron.widgetSlider.press('ArrowRight');
		await notebooksPositron.widgetSlider.press('ArrowRight');
		await expect(notebooksPositron.widgetReadout).toContainText('51');
	});

});
