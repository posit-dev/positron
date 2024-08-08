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

		async function simplePlotTest(app: Application, script: string, locator: string) {

			await app.workbench.positronConsole.pasteCodeToConsole(script);
			await app.workbench.positronConsole.sendEnterKey();
			await app.workbench.positronPlots.waitForWebviewPlot(locator);

			await app.workbench.positronPlots.clearPlots();

			await app.workbench.positronPlots.waitForNoPlots();

		}

		describe('Python Plots', () => {

			before(async function () {
				// Set the viewport to a size that ensures all the plots view actions are visible
				if (process.platform === 'linux') {
					await this.app.code.driver.setViewportSize({ width: 1280, height: 800 });
				}
				await this.app.workbench.positronLayouts.enterLayout('stacked');

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
						// FIXME: Temporarily ignore compilation issue
						// See "Type 'Buffer' is not assignable" errors on https://github.com/microsoft/TypeScript/issues/59451
						// @ts-ignore
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
						// FIXME: Temporarily ignore compilation issue
						// See "Type 'Buffer' is not assignable" errors on https://github.com/microsoft/TypeScript/issues/59451
						// @ts-ignore
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

			it('Python - Verifies bqplot Python widget [C720869]', async function () {
				const app = this.app as Application;

				const script = `import bqplot.pyplot as bplt
import numpy as np

x = np.linspace(-10, 10, 100)
y = np.sin(x)
axes_opts = {"x": {"label": "X"}, "y": {"label": "Y"}}

fig = bplt.figure(title="Line Chart")
line = bplt.plot(
	x=x, y=y, axes_options=axes_opts
)

bplt.show()`;

				await simplePlotTest(app, script, '.svg-figure');

			});

			it('Python - Verifies ipydatagrid Python widget [C720870]', async function () {
				const app = this.app as Application;

				const script = `import pandas as pd
from ipydatagrid import DataGrid
data= pd.DataFrame({"A": [1, 2, 3], "B": [4, 5, 6]}, index=["One", "Two", "Three"])
DataGrid(data)
DataGrid(data, selection_mode="cell", editable=True)`;

				await simplePlotTest(app, script, 'canvas:nth-child(1)');

			});

			it('Python - Verifies ipyleaflet Python widget [C720871]', async function () {
				const app = this.app as Application;

				const script = `from ipyleaflet import Map, Marker, display
center = (52.204793, 360.121558)
map = Map(center=center, zoom=12)

# Add a draggable marker to the map
# Dragging the marker updates the marker.location value in Python
marker = Marker(location=center, draggable=True)
map.add_control(marker)

display(map)`;

				await simplePlotTest(app, script, '.leaflet-container');

			});

			it('Python - Verifies ipytree Python widget [C720872]', async function () {
				const app = this.app as Application;

				const script = `from ipytree import Tree, Node
tree = Tree(stripes=True)
tree
tree
node1 = Node('node1')
tree.add_node(node1)
node2 = Node('node2')
tree.add_node(node2)
tree.nodes = [node2, node1]
node3 = Node('node3', disabled=True)
node4 = Node('node4')
node5 = Node('node5', [Node('1'), Node('2')])
node2.add_node(node3)
node2.add_node(node4)
node2.add_node(node5)
tree.add_node(Node('node6'), 1)
node2.add_node(Node('node7'), 2)

tree`;

				await simplePlotTest(app, script, '.jstree-container-ul');

			});


			it('Python - Verifies boken Python widget [C730343]', async function () {
				const app = this.app as Application;

				const script = `from bokeh.plotting import figure, output_file, show

# instantiating the figure object
graph = figure(title = "Bokeh Line Graph")

# the points to be plotted
x = [1, 2, 3, 4, 5]
y = [5, 4, 3, 2, 1]

# plotting the line graph
graph.line(x, y)

# displaying the model
show(graph)`;


				await app.workbench.positronConsole.pasteCodeToConsole(script);
				await app.workbench.positronConsole.sendEnterKey();

				// selector not factored out as it is unique to bokeh
				const bokehCanvas = '.bk-Canvas';
				await app.workbench.positronPlots.waitForWebviewPlot(bokehCanvas);

				await app.workbench.positronLayouts.enterLayout('fullSizedAuxBar');

				// selector not factored out as it is unique to bokeh
				await app.workbench.positronPlots.getWebviewPlotLocator('.bk-tool-icon-box-zoom').click();

				const canvasLocator = app.workbench.positronPlots.getWebviewPlotLocator(bokehCanvas);
				const boundingBox = await canvasLocator.boundingBox();

				// plot capture before zoom
				const bufferBeforeZoom = await canvasLocator.screenshot();

				if (boundingBox) {

					await app.code.driver.clickAndDrag({
						from: {
							x: boundingBox.x + boundingBox.width / 3,
							y: boundingBox.y + boundingBox.height / 3
						},
						to: {
							x: boundingBox.x + 2 * (boundingBox.width / 3),
							y: boundingBox.y + 2 * (boundingBox.height / 3)
						}
					});
				} else {
					fail('Bounding box not found');
				}

				// plot capture after zoom
				const bufferAfterZoom = await canvasLocator.screenshot();

				// two plot captures should be different
				const data = await compareImages(bufferAfterZoom, bufferBeforeZoom, options);
				expect(data.rawMisMatchPercentage).toBeGreaterThan(0.0);

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();

				await app.workbench.positronLayouts.enterLayout('stacked');

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
						// FIXME: Temporarily ignore compilation issue
						// See "Type 'Buffer' is not assignable" errors on https://github.com/microsoft/TypeScript/issues/59451
						// @ts-ignore
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


			it('R - Verifies rplot plot [C720873]', async function () {
				const app = this.app as Application;

				const script = `library('corrr')

x <- correlate(mtcars)
rplot(x)

# Common use is following rearrange and shave
x <- rearrange(x, absolute = FALSE)
x <- shave(x)
rplot(x)
rplot(x, print_cor = TRUE)
rplot(x, shape = 20, colors = c("red", "green"), legend = TRUE)`;

				await app.workbench.positronConsole.pasteCodeToConsole(script);
				await app.workbench.positronConsole.sendEnterKey();
				await app.workbench.positronPlots.waitForCurrentPlot();

				await app.workbench.positronPlots.clearPlots();

				await app.workbench.positronPlots.waitForNoPlots();

			});

			it('R - Verifies highcharter plot [C720874]', async function () {
				const app = this.app as Application;

				const script = `library(highcharter)

data("mpg", "diamonds", "economics_long", package = "ggplot2")

hchart(mpg, "point", hcaes(x = displ, y = cty, group = year))`;

				await simplePlotTest(app, script, 'svg');

			});

			it('R - Verifies leaflet plot [C720875]', async function () {
				const app = this.app as Application;

				const script = `library(leaflet)
m = leaflet() %>% addTiles()
m = m %>% setView(-93.65, 42.0285, zoom = 17)
m %>% addPopups(-93.65, 42.0285, 'Here is the <b>Department of Statistics</b>, ISU')`;

				await simplePlotTest(app, script, '.leaflet');

			});

			it('R - Verifies plotly plot [C720876]', async function () {
				const app = this.app as Application;

				const script = `library(plotly)
fig <- plot_ly(midwest, x = ~percollege, color = ~state, type = "box")
fig`;

				await simplePlotTest(app, script, '.plot-container');

			});

		});

	});
}
