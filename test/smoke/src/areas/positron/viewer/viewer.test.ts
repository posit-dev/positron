/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
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

			it('R - Verify Viewer functionality with modelsummary [C...]', async function () {

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

			it('R - Verify Viewer functionality with reactable [C...]', async function () {

				const script = `library(reactable)
mtcars |> reactable::reactable()`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				const datsun710 = app.workbench.positronViewer.getViewerLocator('div.rt-td-inner').filter({ hasText: 'Datsun 710' });

				await datsun710.waitFor({ state: 'attached' });

			});

			it('R - Verify Viewer functionality with reprex [C...]', async function () {

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
