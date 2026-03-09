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
		try {
			await app.workbench.viewer.clearViewer();
		} catch {
			// ignore if clearing viewer fails
		}
	});

	test('Python - Verify Viewer opens for WebBrowser calls', { tag: [tags.WEB] }, async function ({ app, python }) {
		test.skip(app.web, 'WebBrowser test not supported in cross-browser mode');
		const { console, viewer } = app.workbench;
		await console.executeCode('Python', pythonScript);
		const theDoc = viewer.getViewerLocator('head');
		await theDoc.waitFor({ state: 'attached' });
	});

	test('Python - Verify Viewer displays great-tables', { tag: [tags.WEB] }, async function ({ app, logger, page, python }) {
		await app.workbench.console.executeCode('Python', pythonGreatTablesScript);

		// Verify that the apricot row is present in the great-tables output table
		const apricot = !app.web
			? app.workbench.viewer.getViewerLocator('td').filter({ hasText: 'apricot' })
			: app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('td').filter({ hasText: 'apricot' });
		await expect(apricot).toBeVisible({ timeout: 30000 });
	});

	test('R - Verify Viewer displays modelsummary output', {
		tag: [tags.WEB, tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', rModelSummaryScript);

		// verify that the bill_depth_mm row is present in the modelsummary output table
		const bellDepthLocator = !app.web
			? app.workbench.viewer.getViewerLocator('tr').filter({ hasText: 'bill_depth_mm' })
			: app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('tr').filter({ hasText: 'bill_depth_mm' });
		await bellDepthLocator.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer displays reactable table output', {
		tag: [tags.WEB, tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', rReactableScript);

		// verify that the Datsun 710 row is present in the reactable output table
		const datsun710 = !app.web
			? app.workbench.viewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' })
			: app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });
		await datsun710.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer displays reprex code output', {
		tag: [tags.WEB, tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', rReprexScript);

		// verify that the rbinom code is present in the reprex output
		const rnorm = !app.web
			? app.workbench.viewer.getViewerLocator('code.sourceCode').filter({ hasText: 'rbinom' })
			: app.workbench.viewer.viewerFrame.frameLocator('iframe').locator('code.sourceCode').filter({ hasText: 'rbinom' });
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
