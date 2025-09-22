/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags, expect } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Viewer', { tag: [tags.VIEWER] }, () => {

	test.afterEach(async function ({ app }) {
		await app.positron.viewer.clearViewer();
	});

	test('Python - Verify Viewer opens for WebBrowser calls', { tag: [tags.WEB] }, async function ({ app, logger, python }) {
		logger.log('Sending code to console');
		await app.positron.console.pasteCodeToConsole(pythonScript);
		await app.positron.console.sendEnterKey();
		const theDoc = app.positron.viewer.getViewerLocator('head');
		await theDoc.waitFor({ state: 'attached' });
	});

	test('Python - Verify Viewer displays great-tables output and can be cleared', { tag: [tags.WEB] }, async function ({ app, logger, page, python }) {
		// Clearing viewer output button has now been implemented. Hence, modifications herein ensure that the button functionality works.
		// Locators
		const apricot = app.positron.viewer.getViewerLocator('td').filter({ hasText: 'apricot' });
		const clearButton = page.locator('.positron-action-bar').getByRole('button', { name: 'Clear the content' });

		// TestStep1: Initial viewer content should be displayed once user runs GreatTablesScript in Console
		await test.step('Display initial viewer content', async () => {
			await app.positron.console.clearButton.click();
			logger.log('Sending code to console');
			await app.positron.console.pasteCodeToConsole(pythonGreatTablesScript);
			await app.positron.console.sendEnterKey();
			await expect(apricot).toBeVisible({ timeout: 30000 });
		});

		// TestStep2: User can click on the 'Clear the content' button in Positron action bar (under Viewer tab)
		await test.step('Click the clear button', async () => {
			await expect(clearButton).toBeVisible();
			await clearButton.click();
		});

		// TestStep3: After user clicked the button, element is NOT present in the DOM, by using detached state.
		await test.step('Verify content disappeared', async () => {
			await apricot.waitFor({ state: 'detached', timeout: 30000 });
		});

		/* Additional comments: to be addressed in the future or limitations
		- Extra clean up - https://github.com/posit-dev/positron/issues/4604
		- Without this, on ubuntu, the Enter key sends to the console
		- It won't work because the pasted code is out of view
		- Additional points for discussion with team:
		-- Is keeping the Python scripts in the end the best method?
		-- Should we have a separate file containing scripts and importing them here?
		-- Having the scripts in the end is a bit impractical, regarding visibility. Thoughts?
		*/

	});

	test('R - Verify Viewer displays modelsummary output', { tag: [tags.WEB, tags.ARK] }, async function ({ app, logger, r }) {
		logger.log('Sending code to console');
		await app.positron.console.executeCode('R', rModelSummaryScript);
		let billDepthLocator;
		if (!app.web) {
			billDepthLocator = app.positron.viewer.getViewerLocator('tr').filter({ hasText: 'bill_depth_mm' });
		} else {
			billDepthLocator = app.positron.viewer.viewerFrame.frameLocator('iframe').locator('tr').filter({ hasText: 'bill_depth_mm' });
		}
		await billDepthLocator.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer displays reactable table output', {
		annotation: [{ type: 'web issue', description: 'https://github.com/posit-dev/positron/issues/5972' }],
		tag: [tags.ARK]
	}, async function ({ app, logger, r }) {

		logger.log('Sending code to console');
		await app.positron.console.executeCode('R', rReactableScript);

		const datsun710 = app.positron.viewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });

		await datsun710.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer displays reprex code output', {
		annotation: [{ type: 'web issue', description: 'https://github.com/posit-dev/positron/issues/5975' }],
		tag: [tags.ARK]
	}, async function ({ app, logger, r }) {

		logger.log('Sending code to console');
		await app.positron.console.executeCode('R', rReprexScript);

		const rnorm = app.positron.viewer.getViewerLocator('code.sourceCode').filter({ hasText: 'rbinom' });

		await rnorm.waitFor({ state: 'attached' });

	});

});

const pythonScript = `import webbrowser
# will not have any content, but we just want to make sure
# the viewer will open when webbrowser calls are make
webbrowser.open('http://127.0.0.1:8000')`;

const pythonGreatTablesScript = `from great_tables import GT, exibble
GT(exibble)`;

const rModelSummaryScript = `library(palmerpenguins)
library(fixest)
library(modelsummary)
m1 = feols(body_mass_g ~ bill_depth_mm + bill_length_mm | species, data = penguins)
modelsummary(m1)`;

const rReactableScript = `library(reactable)
mtcars |> reactable::reactable()`;

const rReprexScript = `reprex::reprex(rbinom(3, size = 10, prob = 0.5), comment = "#;-)")`;
