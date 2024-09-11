/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Viewer', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;

		describe('Viewer - Python', () => {
			beforeEach(async function () {
				app = this.app as Application;

				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python - Verify Viewer functionality with vetiver [C784887]', async function () {

				const script = `from vetiver import VetiverModel, VetiverAPI
from vetiver.data import mtcars
from sklearn.linear_model import LinearRegression

model = LinearRegression().fit(mtcars.drop(columns="mpg"), mtcars["mpg"])
v = VetiverModel(model, model_name = "cars_linear", prototype_data = mtcars.drop(columns="mpg"))
VetiverAPI(v).run()`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.pasteCodeToConsole(script);
				await app.workbench.positronConsole.sendEnterKey();

				const theDoc = app.workbench.positronViewer.getViewerLocator('#thedoc');

				await theDoc.waitFor({ state: 'attached' });

				await app.workbench.positronConsole.activeConsole.click();
				await app.workbench.positronConsole.sendKeyboardKey('Control+C');

				await app.workbench.positronConsole.waitForConsoleContents(buffer => buffer.some(line => line.includes('Application shutdown complete.')));

				await app.workbench.positronViewer.clearViewer();

			});

			it('Python - Verify Viewer functionality with great-tables [C784888]', async function () {

				// extra clean up - https://github.com/posit-dev/positron/issues/4604
				// without this, on ubuntu, the Enter key send to the console
				// won't work because the pasted code is out of view
				await app.workbench.positronConsole.barClearButton.click();

				const script = `from great_tables import GT, exibble
GT(exibble)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.pasteCodeToConsole(script);
				await app.workbench.positronConsole.sendEnterKey();

				const apricot = app.workbench.positronViewer.getViewerLocator('td').filter({ hasText: 'apricot' });

				await apricot.waitFor({ state: 'attached' });

				// Note that there is not a control to clear the viewer at this point

			});

		});
	});

	describe('Viewer', () => {
		// Shared before/after handling
		installAllHandlers(logger);

		let app: Application;

		describe('Viewer - R', () => {
			before(async function () {
				app = this.app as Application;

				await PositronRFixtures.SetupFixtures(this.app as Application);
			});

			after(async function () {
				await app.workbench.positronViewer.clearViewer();

			});

			it('R - Verify Viewer functionality with modelsummary [C784889]', async function () {

				const script = `library(palmerpenguins)
library(fixest)
library(modelsummary)
m1 = feols(body_mass_g ~ bill_depth_mm + bill_length_mm | species, data = penguins)
modelsummary(m1)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				const billDepthLocator = app.workbench.positronViewer.getViewerLocator('tr').filter({ hasText: 'bill_depth_mm' });

				await billDepthLocator.waitFor({ state: 'attached' });

			});

			it('R - Verify Viewer functionality with reactable [C784930]', async function () {

				const script = `library(reactable)
mtcars |> reactable::reactable()`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				const datsun710 = app.workbench.positronViewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });

				await datsun710.waitFor({ state: 'attached' });

			});

			it('R - Verify Viewer functionality with reprex [C784931]', async function () {

				const script = `reprex::reprex({
x <- rnorm(100)
plot(x, sin(x))
})`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				const rnorm = app.workbench.positronViewer.getViewerLocator('code.sourceCode').filter({ hasText: 'x <- rnorm(100)' });

				await rnorm.waitFor({ state: 'attached' });

			});
		});
	});
}
