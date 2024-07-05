/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';


/*
 * Plots test cases
 */
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

			it('Python - Verifies basic plot functionality - Dynamic Plot [C608114]', async function () {
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

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('Python - Verifies basic plot functionality - Static Plot', async function () {
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

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});

			it('Python - Verifies the plots pane action bar - Plot actions', async function () {
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
				const clearPlotsButton = app.workbench.positronPlots.clearPlotsButton;
				const nextPlotButton = app.workbench.positronPlots.nextPlotButton;
				const previousPlotButton = app.workbench.positronPlots.previousPlotButton;
				const plotSizeButton = app.workbench.positronPlots.plotSizeButton;
				const savePlotButton = app.workbench.positronPlots.savePlotButton;
				const copyPlotButton = app.workbench.positronPlots.copyPlotButton;
				const zoomPlotButton = app.workbench.positronPlots.zoomPlotButton;

				// default plot pane state for action bar
				await plotSizeButton.isNotVisible();
				await savePlotButton.isNotVisible();
				await copyPlotButton.isNotVisible();
				await zoomPlotButton.isNotVisible();

				// create plots separately so that the order is known
				await app.workbench.positronConsole.executeCode('Python', scriptPlot1, '>>>');
				await app.workbench.positronPlots.waitForCurrentStaticPlot();
				await app.workbench.positronConsole.executeCode('Python', scriptPlot2, '>>>');
				await app.workbench.positronPlots.waitForCurrentPlot();

				expect(await clearPlotsButton.getAttribute('disabled'), 'Clear plots button should not be disabled').toBeUndefined();
				expect(await nextPlotButton.getAttribute('disabled'), 'Next plot button should be disabled').toBeDefined();
				expect(await previousPlotButton.getAttribute('disabled'), 'Previous plot button should not be disabled').toBeUndefined();
				expect(await plotSizeButton.getAttribute('disabled'), 'Plot size button should not be disabled').toBeUndefined();
				expect(await savePlotButton.getAttribute('disabled'), 'Save plot button should not be disabled').toBeUndefined();
				expect(await copyPlotButton.getAttribute('disabled'), 'Copy plot button should not be disabled').toBeUndefined();

				await app.workbench.positronPlots.previousPlot();

				// switching to fized size plot changes action bar
				await zoomPlotButton.waitforVisible();
				await plotSizeButton.isNotVisible();

				expect(await clearPlotsButton.getAttribute('disabled'), 'Clear plots button should not be disabled').toBeUndefined();
				expect(await nextPlotButton.getAttribute('disabled'), 'Next plot button should not be disabled').toBeUndefined();
				expect(await previousPlotButton.getAttribute('disabled'), 'Previous plot button should be disabled').toBeDefined();
				expect(await zoomPlotButton.getAttribute('disabled'), 'Zoom plot button should not be disabled').toBeUndefined();

				await app.workbench.positronPlots.nextPlot();
				await app.workbench.positronPlots.waitForCurrentPlot();

				await zoomPlotButton.isNotVisible();
				await plotSizeButton.waitforVisible();

				expect(await clearPlotsButton.getAttribute('disabled'), 'Clear plots button should not be disabled').toBeUndefined();
				expect(await nextPlotButton.getAttribute('disabled'), 'Next plot button should be disabled').toBeDefined();
				expect(await previousPlotButton.getAttribute('disabled'), 'Previous plot button should not be disabled').toBeUndefined();
				expect(await plotSizeButton.getAttribute('disabled'), 'Plot size button should not be disabled').toBeUndefined();

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

			it('R - Verifies basic plot functionality [C628633]', async function () {
				const app = this.app as Application;

				const script = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				await app.workbench.positronPlots.waitForCurrentPlot();

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();
			});
		});

	});
}
