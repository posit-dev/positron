/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import * as path from 'path';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { readFileSync } from 'fs';
import compareImages = require('resemblejs/compareImages');
import { ComparisonOptions } from 'resemblejs';
import * as fs from 'fs';
import { fail } from 'assert';

/*
 * Plots test cases
 */
export function setup(logger: Logger) {

	const diffPlotsPath = ['..', '..', '.build', 'logs', 'smoke-tests-electron'];

	const options: ComparisonOptions = {
		output: {
			errorColor: {
				red: 255,
				green: 0,
				blue: 255
			},
			errorType: 'movement',
			transparency: 0.3,
			largeImageThreshold: 1200,
			useCrossOrigin: false
		},
		scaleToSameSize: true,
		ignore: 'antialiasing',
	};

	const githubActions = process.env.GITHUB_ACTIONS === "true";

	describe('Plots', () => {

		// Shared before/after handling
		installAllHandlers(logger);

		describe('Python Plots', () => {

			before(async function () {

				await PositronPythonFixtures.SetupFixtures(this.app as Application);

			});

			it('Python - Verifies basic plot functionality - Dynamic Plot [C608114] #pr', async function () {
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

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				const buffer = await app.workbench.positronPlots.getCurrentPlotAsBuffer();

				const data = await compareImages(readFileSync(path.join('plots', 'pythonScatterplot.png'),), buffer, options);

				if (githubActions && data.rawMisMatchPercentage > 2.0) {
					if (data.getBuffer) {
						fs.writeFileSync(path.join(...diffPlotsPath, 'pythonScatterplotDiff.png'), data.getBuffer(true));
					}
					// capture a new master image in CI
					await app.workbench.positronPlots.currentPlot.screenshot({ path: path.join(...diffPlotsPath, 'pythonScatterplot.png') });

					fail(`Image comparison failed with mismatch percentage: ${data.rawMisMatchPercentage}`);
				}

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('Python - Verifies basic plot functionality - Static Plot [C654401] #pr', async function () {
				const app = this.app as Application;

				const script = `import graphviz as gv
import IPython

h = gv.Digraph(format="svg")
names = [
    "A",
    "B",
    "C",
]

# Specify edges
h.edge("A", "B")
h.edge("A", "C")

IPython.display.display_png(h)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				await app.workbench.positronPlots.waitForCurrentStaticPlot();

				const buffer = await app.workbench.positronPlots.getCurrentStaticPlotAsBuffer();

				const data = await compareImages(readFileSync(path.join('plots', 'graphviz.png'),), buffer, options);

				if (githubActions && data.rawMisMatchPercentage > 2.0) {
					if (data.getBuffer) {
						fs.writeFileSync(path.join(...diffPlotsPath, 'graphvizDiff.png'), data.getBuffer(true));
					}
					// capture a new master image in CI
					await app.workbench.positronPlots.currentPlot.screenshot({ path: path.join(...diffPlotsPath, 'graphviz.png') });

					fail(`Image comparison failed with mismatch percentage: ${data.rawMisMatchPercentage}`);
				}

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('Python - Verifies the plots pane action bar - Plot actions [C656297]', async function () {
				const app = this.app as Application;

				const scriptPlot1 = `import graphviz as gv
import IPython

h = gv.Digraph(format="svg")
names = [
    "A",
    "B",
    "C",
]

# Specify edges
h.edge("A", "B")
h.edge("A", "C")

IPython.display.display_png(h)`;

				const scriptPlot2 = `import matplotlib.pyplot as plt

# x axis values
x = [1,2,3]
# corresponding y axis values
y = [2,4,1]

# plotting the points
plt.plot(x, y)

# naming the x axis
plt.xlabel('x - axis')
# naming the y axis
plt.ylabel('y - axis')

# giving a title to my graph
plt.title('My first graph!')

# function to show the plot
plt.show()`;
				logger.log('Sending code to console');

				// default plot pane state for action bar
				await expect(app.workbench.positronPlots.plotSizeButton).not.toBeVisible();
				await expect(app.workbench.positronPlots.savePlotButton).not.toBeVisible();
				await expect(app.workbench.positronPlots.copyPlotButton).not.toBeVisible();
				await expect(app.workbench.positronPlots.zoomPlotButton).not.toBeVisible();

				// create plots separately so that the order is known
				await app.workbench.positronConsole.executeCode('Python', scriptPlot1, '>>>');
				await app.workbench.positronPlots.waitForCurrentStaticPlot();
				await app.workbench.positronConsole.executeCode('Python', scriptPlot2, '>>>');
				await app.workbench.positronPlots.waitForCurrentPlot();

				await expect(app.workbench.positronPlots.clearPlotsButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.nextPlotButton).toBeDisabled();
				await expect(app.workbench.positronPlots.previousPlotButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.plotSizeButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.savePlotButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.copyPlotButton).not.toBeDisabled();

				// switch to fixed size plot
				await app.workbench.positronPlots.previousPlotButton.click();
				await app.workbench.positronPlots.waitForCurrentStaticPlot();

				// switching to fized size plot changes action bar
				await expect(app.workbench.positronPlots.zoomPlotButton).toBeVisible();
				await expect(app.workbench.positronPlots.plotSizeButton).not.toBeVisible();

				await expect(app.workbench.positronPlots.clearPlotsButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.nextPlotButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.previousPlotButton).toBeDisabled();
				await expect(app.workbench.positronPlots.zoomPlotButton).not.toBeDisabled();

				// switch back to dynamic plot
				await app.workbench.positronPlots.nextPlotButton.click();
				await app.workbench.positronPlots.waitForCurrentPlot();

				await expect(app.workbench.positronPlots.zoomPlotButton).toBeVisible();
				await expect(app.workbench.positronPlots.plotSizeButton).toBeVisible();

				await expect(app.workbench.positronPlots.clearPlotsButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.nextPlotButton).toBeDisabled();
				await expect(app.workbench.positronPlots.previousPlotButton).not.toBeDisabled();
				await expect(app.workbench.positronPlots.plotSizeButton).not.toBeDisabled();

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('Python - Verifies saving a Python plot [C557005]', async function () {
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

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				// save again with a different name and file format
				await app.workbench.positronPlots.savePlotButton.click();

				await app.workbench.positronPopups.waitForModalDialogBox();

				// fill in the file name and change file format to JPEG
				await app.code.driver.getLocator('.positron-modal-dialog-box .file .text-input').fill('Python-scatter');
				await app.code.driver.getLocator('.positron-modal-dialog-box .file .positron-button.drop-down-list-box').click();
				await app.workbench.positronPopups.clickOnModalDialogPopupOption('JPEG');

				// save the plot
				await app.workbench.positronPopups.clickOkOnModalDialogBox();

				// verify the plot is in the file explorer with the new file name and format
				await app.workbench.positronExplorer.waitForProjectFileToAppear('Python-scatter.jpeg');

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});
		});

		describe('R Plots', () => {

			before(async function () {

				await PositronRFixtures.SetupFixtures(this.app as Application);

			});

			it('R - Verifies basic plot functionality [C628633] #pr', async function () {
				const app = this.app as Application;

				const script = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				const buffer = await app.workbench.positronPlots.getCurrentPlotAsBuffer();

				const data = await compareImages(readFileSync(path.join('plots', 'autos.png'),), buffer, options);

				if (githubActions && data.rawMisMatchPercentage > 2.0) {
					if (data.getBuffer) {
						fs.writeFileSync(path.join(...diffPlotsPath, 'autosDiff.png'), data.getBuffer(true));
					}
					// capture a new master image in CI
					await app.workbench.positronPlots.currentPlot.screenshot({ path: path.join(...diffPlotsPath, 'autos.png') });

					fail(`Image comparison failed with mismatch percentage: ${data.rawMisMatchPercentage}`);
				}

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('R - Verifies saving an R plot [C557006]', async function () {
				const app = this.app as Application;

				const script = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

				logger.log('Sending code to console');
				// create a plot
				await app.workbench.positronConsole.executeCode('R', script, '>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				// click save to bring up the modal save dialog
				await app.workbench.positronPlots.savePlotButton.click();

				await app.workbench.positronPopups.waitForModalDialogBox();

				// save with defaults
				await app.workbench.positronPopups.clickOkOnModalDialogBox();

				// verify a plot is in the file explorer with the default file name
				await app.workbench.positronExplorer.waitForProjectFileToAppear('plot.png');

				// save again with a different name and file format
				await app.workbench.positronPlots.savePlotButton.click();

				await app.workbench.positronPopups.waitForModalDialogBox();

				// fill in the file name and change file format to SVG
				await app.code.driver.getLocator('.positron-modal-dialog-box .file .text-input').fill('R-cars');
				await app.code.driver.getLocator('.positron-modal-dialog-box .file .positron-button.drop-down-list-box').click();
				await app.workbench.positronPopups.clickOnModalDialogPopupOption('SVG');

				// save the plot
				await app.workbench.positronPopups.clickOkOnModalDialogBox();

				// verify the plot is in the file explorer with the new file name and format
				await app.workbench.positronExplorer.waitForProjectFileToAppear('R-cars.svg');

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});
		});

	});
}
