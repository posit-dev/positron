/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect } from './_test.setup';

test.describe.skip('Viewer', () => {
	test('Python - Verify Viewer functionality with vetiver [C784887]', async function ({ app, interpreter }) {
		test.setTimeout(120000);
		await interpreter.set('Python');

		await app.workbench.positronConsole.pasteCodeToConsole(pythonScripts.vetiver);
		await app.workbench.positronConsole.sendEnterKey();

		const theDoc = app.workbench.positronViewer.getViewerLocator('#thedoc');
		await theDoc.waitFor({ state: 'attached', timeout: 60000 });

		await app.workbench.positronConsole.activeConsole.click();
		await app.workbench.positronConsole.sendKeyboardKey('Control+C');
		await app.workbench.positronConsole.waitForConsoleContents(buffer => buffer.some(line => line.includes('Application shutdown complete.')));
		await app.workbench.positronViewer.clearViewer();

	});

	// This randomly fails only in CI
	test.skip('Python - Verify Viewer functionality with great-tables [C784888]', {
		annotation: { type: "issue", description: 'randomly fails in CI' }
	}, async function ({ app, interpreter }) {
		test.setTimeout(120000);
		await interpreter.set('Python');

		// extra clean up - https://github.com/posit-dev/positron/issues/4604
		// without this, on ubuntu, the Enter key send to the console
		// won't work because the pasted code is out of view
		await app.workbench.positronConsole.barClearButton.click();
		await app.workbench.positronConsole.pasteCodeToConsole(pythonScripts.greatTables);
		await app.workbench.positronConsole.sendEnterKey();
		const apricot = app.workbench.positronViewer.getViewerLocator('td').filter({ hasText: 'apricot' });
		await apricot.waitFor({ state: 'attached', timeout: 60000 });

		// Note that there is not a control to clear the viewer at this point
	});

	test('R - Verify Viewer functionality with model summary [C784889]', async function ({ app, interpreter }) {
		await interpreter.set('R');

		await app.workbench.positronConsole.executeCode('R', rScripts.modelSummary, '>');
		const billDepthLocator = app.workbench.positronViewer.getViewerLocator('tr').filter({ hasText: 'bill_depth_mm' });
		await billDepthLocator.waitFor({ state: 'attached' });
	});

	test('R - Verify Viewer functionality with reactable [C784930]', async function ({ app, interpreter }) {
		await interpreter.set('R');

		await app.workbench.positronConsole.executeCode('R', rScripts.reactable, '>');
		const datsun710 = app.workbench.positronViewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });
		await datsun710.waitFor({ state: 'attached' });

	});

	test('R - Verify Viewer functionality with reprex [C784931]', async function ({ app, interpreter }) {
		await interpreter.set('R');

		await app.workbench.positronConsole.executeCode('R', rScripts.reprex, '>');
		const rnorm = app.workbench.positronViewer.getViewerLocator('code.sourceCode').filter({ hasText: 'x <- rnorm(100)' });
		await rnorm.waitFor({ state: 'attached' });
	});
});

const rScripts = {
	modelSummary: `library(palmerpenguins)
library(fixest)
library(modelsummary)
m1 = feols(body_mass_g ~ bill_depth_mm + bill_length_mm | species, data = penguins)
modelsummary(m1)`,
	reactable: `library(reactable)
mtcars |> reactable::reactable()`,
	reprex: `reprex::reprex({
x <- rnorm(100)
plot(x, sin(x))
})`
};

const pythonScripts = {
	vetiver: `from vetiver import VetiverModel, VetiverAPI
from vetiver.data import mtcars
from sklearn.linear_model import LinearRegression

model = LinearRegression().fit(mtcars.drop(columns="mpg"), mtcars["mpg"])
v = VetiverModel(model, model_name = "cars_linear", prototype_data = mtcars.drop(columns="mpg"))
VetiverAPI(v).run()`,
	greatTables: `from great_tables import GT, exibble
GT(exibble)`};
