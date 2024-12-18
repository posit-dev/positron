/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Viewer', { tag: [tags.VIEWER] }, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.positronViewer.clearViewer();
	});

	test('Python - Verify Viewer functionality with webbrowser [C784887]', async function ({ app, page, logger, python }) {
		logger.log('Sending code to console');
		await app.workbench.positronConsole.pasteCodeToConsole(pythonScript);
		await app.workbench.positronConsole.sendEnterKey();
		const theDoc = app.workbench.positronViewer.getViewerLocator('head');
		await theDoc.waitFor({ state: 'attached' });
	});

	// This randomly fails only in CI
	test.skip('Python - Verify Viewer functionality with great-tables [C784888]', async function ({ app, logger, python }) {

		// extra clean up - https://github.com/posit-dev/positron/issues/4604
		// without this, on ubuntu, the Enter key send to the console
		// won't work because the pasted code is out of view
		await app.workbench.positronConsole.barClearButton.click();

		logger.log('Sending code to console');
		await app.workbench.positronConsole.pasteCodeToConsole(pythonGreatTablesScript);
		await app.workbench.positronConsole.sendEnterKey();

		const apricot = app.workbench.positronViewer.getViewerLocator('td').filter({ hasText: 'apricot' });
		await apricot.waitFor({ state: 'attached', timeout: 60000 });

		// Note that there is not a control to clear the viewer at this point
	});


	test('R - Verify Viewer functionality with modelsummary [C784889]', async function ({ app, logger, r }) {
		logger.log('Sending code to console');
		await app.workbench.positronConsole.executeCode('R', rModelSummaryScript, '>');
		const billDepthLocator = app.workbench.positronViewer.getViewerLocator('tr').filter({ hasText: 'bill_depth_mm' });
		await billDepthLocator.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer functionality with reactable [C784930]', async function ({ app, logger, r }) {

		logger.log('Sending code to console');
		await app.workbench.positronConsole.executeCode('R', rReactableScript, '>');

		const datsun710 = app.workbench.positronViewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });

		await datsun710.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer functionality with reprex [C784931]', async function ({ app, logger, r }) {

		logger.log('Sending code to console');
		await app.workbench.positronConsole.executeCode('R', rReprexScript, '>');

		const rnorm = app.workbench.positronViewer.getViewerLocator('code.sourceCode').filter({ hasText: 'x <- rnorm(100)' });

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


const rReprexScript = `reprex::reprex({
	x <- rnorm(100)
	plot(x, sin(x))
	})`;
