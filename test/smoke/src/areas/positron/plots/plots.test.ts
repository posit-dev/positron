/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { Application, Logger, PositronPythonFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { PositronConsoleFixtures } from '../../../fixtures/positronConsoleFixtures';


export function setup(logger: Logger) {
	describe('Plots', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Plots', () => {

			before(async function () {

				const app = this.app as Application;

				const pythonFixtures = new PositronPythonFixtures(app);
				await pythonFixtures.startPythonInterpreter();

				const consoleFixtures = new PositronConsoleFixtures(app);
				await consoleFixtures.updateTerminalSettings();

			});

			after(async function () {

				const app = this.app as Application;
				await app.workbench.settingsEditor.clearUserSettings();

			});

			it.only('Python - Verifies basic plot functionality', async function () {
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
				await app.workbench.positronConsole.typeToConsole(script);
				console.log('Sending enter key');
				await app.workbench.positronConsole.sendEnterKey();

				await app.workbench.positronConsole.waitForReady('>>>');

				const plotLocator = app.code.driver.getLocator('.image-wrapper img');

				await plotLocator.waitFor({ state: 'attached' });
			});
		});

	});
}
