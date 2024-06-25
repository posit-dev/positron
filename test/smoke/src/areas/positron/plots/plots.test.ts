/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';


export function setup(logger: Logger) {
	describe('Plots', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Plots', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

			});

			it('Python - Verifies basic plot functionality - Dynamic Plot', async function () {
				// TestRail #608114
				const app = this.app as Application;

				// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
				const script = `import pandas as pd
import matplotlib.pyplot as plt
data_dict = {'name': ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
				'age': [20, 20, 21, 20, 21, 20],
				'math_marks': [100, 90, 91, 98, 92, 95],
				'physics_marks': [90, 100, 91, 92, 98, 95],
				'chem_marks': [93, 89, 99, 92, 94, 92]
				}

df = pd.DataFrame(data_dict)

df.plot(kind='scatter',
		x='math_marks',
		y='physics_marks',
		color='red')

plt.title('ScatterPlot')
plt.show()`;

				console.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});
		});

		describe('R Plots', () => {

			before(async function () {

				const app = this.app as Application;

				const rFixtures = new PositronRFixtures(app);
				await rFixtures.startRInterpreter();

			});

			it('R - Verifies basic plot functionality', async function () {
				// TestRail #628633
				const app = this.app as Application;

				const script = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

				console.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});
		});

	});
}
