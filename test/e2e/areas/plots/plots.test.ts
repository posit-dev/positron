/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { test, expect, tags } from '../_test.setup';
const resembleCompareImages = require('resemblejs/compareImages');
import { ComparisonOptions } from 'resemblejs';
import * as fs from 'fs';
import { fail } from 'assert';
import { Application } from '../../../automation';

test.use({
	suiteId: __filename
});

test.describe('Plots', { tag: [tags.PLOTS, tags.EDITOR] }, () => {
	// Some tests are not tagged @win because they would require a new master image.
	test.describe('Python Plots', () => {

		test.beforeAll(async function ({ userSettings }) {
			await userSettings.set([['application.experimental.positronPlotsInEditorTab', 'true']]);
		});

		test.beforeEach(async function ({ app, interpreter }) {
			// Set the viewport to a size that ensures all the plots view actions are visible
			if (process.platform === 'linux') {
				await app.code.driver.setViewportSize({ width: 1280, height: 800 });
			}

			await interpreter.set('Python');
			await app.workbench.layouts.enterLayout('stacked');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			await app.workbench.plots.clearPlots();
			await app.workbench.plots.waitForNoPlots();
		});

		test('Python - Verifies basic plot functionality - Dynamic Plot [C608114]', {
			tag: [tags.CRITICAL, tags.WEB, tags.WIN]
		}, async function ({ app, logger, headless, logsPath }, testInfo) {
			// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
			logger.log('Sending code to console');
			await app.workbench.console.executeCode('Python', pythonDynamicPlot, '>>>');
			await app.workbench.plots.waitForCurrentPlot();

			const buffer = await app.workbench.plots.getCurrentPlotAsBuffer();
			await compareImages({
				app,
				buffer,
				diffScreenshotName: 'pythonScatterplotDiff',
				masterScreenshotName: `pythonScatterplot-${process.platform}`,
				testInfo: testInfo
			});

			if (!headless) {
				await app.workbench.plots.copyCurrentPlotToClipboard();

				let clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
				expect(clipboardImageBuffer).not.toBeNull();

				await app.workbench.clipboard.clearClipboard();
				clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
				expect(clipboardImageBuffer).toBeNull();
			}

			await test.step('Verify plot can be opened in editor', async () => {
				await app.workbench.plots.openPlotInEditor();
				await app.workbench.plots.waitForPlotInEditor();
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			});

			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			await app.workbench.plots.clearPlots();
			await app.workbench.layouts.enterLayout('stacked');
			await app.workbench.plots.waitForNoPlots();
		});

		test('Python - Verifies basic plot functionality - Static Plot [C654401]', {
			tag: [tags.CRITICAL, tags.WEB, tags.WIN]
		}, async function ({ app, logger, logsPath }, testInfo) {
			logger.log('Sending code to console');
			await app.workbench.console.executeCode('Python', pythonStaticPlot, '>>>');
			await app.workbench.plots.waitForCurrentStaticPlot();

			const buffer = await app.workbench.plots.getCurrentStaticPlotAsBuffer();
			await compareImages({
				app,
				buffer,
				diffScreenshotName: 'graphvizDiff',
				masterScreenshotName: `graphviz-${process.platform}`,
				testInfo
			});

			await test.step('Verify plot can be opened in editor', async () => {
				await app.workbench.plots.openPlotInEditor();
				await app.workbench.plots.waitForPlotInEditor();
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			});

		});

		test('Python - Verifies the plots pane action bar - Plot actions [C656297]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			const plots = app.workbench.plots;

			// default plot pane state for action bar
			await expect(plots.plotSizeButton).not.toBeVisible();
			await expect(plots.savePlotButton).not.toBeVisible();
			await expect(plots.copyPlotButton).not.toBeVisible();
			await expect(plots.zoomPlotButton).not.toBeVisible();

			// create plots separately so that the order is known
			await app.workbench.console.executeCode('Python', pythonPlotActions1, '>>>');
			await plots.waitForCurrentStaticPlot();
			await app.workbench.console.executeCode('Python', pythonPlotActions2, '>>>');
			await plots.waitForCurrentPlot();

			// expand the plot pane to show the action bar
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			await expect(plots.clearPlotsButton).not.toBeDisabled();
			await expect(plots.nextPlotButton).toBeDisabled();
			await expect(plots.previousPlotButton).not.toBeDisabled();
			await expect(plots.plotSizeButton).not.toBeDisabled();
			await expect(plots.savePlotButton).not.toBeDisabled();
			await expect(plots.copyPlotButton).not.toBeDisabled();

			// switch to fixed size plot
			await plots.previousPlotButton.click();
			await plots.waitForCurrentStaticPlot();

			// switching to fixed size plot changes action bar
			await expect(plots.zoomPlotButton).toBeVisible();
			await expect(plots.plotSizeButton).not.toBeVisible();
			await expect(plots.clearPlotsButton).not.toBeDisabled();
			await expect(plots.nextPlotButton).not.toBeDisabled();
			await expect(plots.previousPlotButton).toBeDisabled();
			await expect(plots.zoomPlotButton).not.toBeDisabled();

			// switch back to dynamic plot
			await plots.nextPlotButton.click();
			await plots.waitForCurrentPlot();
			await expect(plots.zoomPlotButton).toBeVisible();
			await expect(plots.plotSizeButton).toBeVisible();
			await expect(plots.clearPlotsButton).not.toBeDisabled();
			await expect(plots.nextPlotButton).toBeDisabled();
			await expect(plots.previousPlotButton).not.toBeDisabled();
			await expect(plots.plotSizeButton).not.toBeDisabled();
		});

		test('Python - Verifies saving a Python plot [C557005]', { tag: [tags.WIN] }, async function ({ app, logger }) {
			logger.log('Sending code to console');
			await app.workbench.console.executeCode('Python', savePlot, '>>>');
			await app.workbench.plots.waitForCurrentPlot();
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');

			await app.workbench.plots.savePlot({ name: 'Python-scatter', format: 'JPEG' });
			await app.workbench.layouts.enterLayout('stacked');
			await app.workbench.explorer.waitForProjectFileToAppear('Python-scatter.jpeg');
		});

		test('Python - Verifies bqplot Python widget [C720869]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, bgplot, '.svg-figure');
		});

		test('Python - Verifies ipydatagrid Python widget [C720870]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, ipydatagrid, 'canvas:nth-child(1)');
		});

		test('Python - Verifies ipyleaflet Python widget [C720871]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, ipyleaflet, '.leaflet-container');
		});

		test('Python - Verifies hvplot can load with plotly extension [C766660]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, plotly, '.plotly');
		});

		test('Python - Verifies ipytree Python widget [C720872]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, ipytree, '.jstree-container-ul');

			// fullauxbar layout needed for some smaller windows
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');

			// tree should be expanded by default
			const treeNodes = app.workbench.plots.getWebviewPlotLocator('.jstree-container-ul .jstree-node');
			await expect(treeNodes).toHaveCount(9);

			// collapse the tree, only parent nodes should be visible
			await treeNodes.first().click({ position: { x: 0, y: 0 } }); // target the + icon
			await expect(treeNodes).toHaveCount(3);
		});

		test('Python - Verifies ipywidget.Output Python widget', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await app.workbench.console.pasteCodeToConsole(ipywidgetOutput);
			await app.workbench.console.sendEnterKey();
			await app.workbench.plots.waitForWebviewPlot('.widget-output', 'attached');

			// Redirect a print statement to the Output widget.
			await app.workbench.console.pasteCodeToConsole(`with output:
	print('Hello, world!')
`);  // Empty line needed for the statement to be considered complete.
			await app.workbench.console.sendEnterKey();
			await app.workbench.plots.waitForWebviewPlot('.widget-output .jp-OutputArea-child');

			// The printed statement should not be shown in the console.
			await app.workbench.console.waitForConsoleContents('Hello World', { expectedCount: 0 });

		});

		test('Python - Verifies bokeh Python widget [C730343]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await app.workbench.console.pasteCodeToConsole(bokeh);
			await app.workbench.console.sendEnterKey();

			// selector not factored out as it is unique to bokeh
			const bokehCanvas = '.bk-Canvas';
			await app.workbench.plots.waitForWebviewPlot(bokehCanvas);
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');

			// selector not factored out as it is unique to bokeh
			await app.workbench.plots.getWebviewPlotLocator('.bk-tool-icon-box-zoom').click();
			const canvasLocator = app.workbench.plots.getWebviewPlotLocator(bokehCanvas);
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
			const data = await resembleCompareImages(bufferAfterZoom, bufferBeforeZoom, options);
			expect(data.rawMisMatchPercentage).toBeGreaterThan(0.0);
		});
	});

	test.describe('R Plots', () => {

		test.beforeAll(async function ({ userSettings }) {
			await userSettings.set([['application.experimental.positronPlotsInEditorTab', 'true']]);
		});

		test.beforeEach(async function ({ app, interpreter }) {
			await app.workbench.layouts.enterLayout('stacked');
			await interpreter.set('R');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			await app.workbench.plots.clearPlots();
			await app.workbench.plots.waitForNoPlots();
		});

		test('R - Verifies basic plot functionality [C628633]', {
			tag: [tags.CRITICAL, tags.WEB, tags.WIN]
		}, async function ({ app, logger, headless, logsPath }, testInfo) {
			logger.log('Sending code to console');
			await app.workbench.console.executeCode('R', rBasicPlot, '>');
			await app.workbench.plots.waitForCurrentPlot();

			const buffer = await app.workbench.plots.getCurrentPlotAsBuffer();
			await compareImages({
				app,
				buffer,
				diffScreenshotName: 'autosDiff',
				masterScreenshotName: `autos-${process.platform}`,
				testInfo
			});

			if (!headless) {
				await app.workbench.plots.copyCurrentPlotToClipboard();

				let clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
				expect(clipboardImageBuffer).not.toBeNull();

				await app.workbench.clipboard.clearClipboard();
				clipboardImageBuffer = await app.workbench.clipboard.getClipboardImage();
				expect(clipboardImageBuffer).toBeNull();
			}

			await test.step('Verify plot can be opened in editor', async () => {
				await app.workbench.plots.openPlotInEditor();
				await app.workbench.plots.waitForPlotInEditor();
				await app.workbench.quickaccess.runCommand('workbench.action.closeAllEditors');
			});

			await app.workbench.layouts.enterLayout('fullSizedAuxBar');
			await app.workbench.plots.clearPlots();
			await app.workbench.layouts.enterLayout('stacked');
			await app.workbench.plots.waitForNoPlots();
		});

		test('R - Verifies saving an R plot [C557006]', { tag: [tags.WIN] }, async function ({ app, logger }) {
			logger.log('Sending code to console');

			await app.workbench.console.executeCode('R', rSavePlot, '>');
			await app.workbench.plots.waitForCurrentPlot();

			await app.workbench.plots.savePlot({ name: 'plot', format: 'PNG' });
			await app.workbench.explorer.waitForProjectFileToAppear('plot.png');

			await app.workbench.plots.savePlot({ name: 'R-cars', format: 'SVG' });
			await app.workbench.explorer.waitForProjectFileToAppear('R-cars.svg');
		});

		test('R - Verifies rplot plot [C720873]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await app.workbench.console.pasteCodeToConsole(rplot);
			await app.workbench.console.sendEnterKey();
			await app.workbench.plots.waitForCurrentPlot();
		});

		test('R - Verifies highcharter plot [C720874]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, highcharter, 'svg', app.web);
		});

		test('R - Verifies leaflet plot [C720875]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, leaflet, '.leaflet', app.web);
		});

		test('R - Verifies plotly plot [C720876]', { tag: [tags.WEB, tags.WIN] }, async function ({ app }) {
			await runScriptAndValidatePlot(app, rPlotly, '.plot-container', app.web);
		});
	});
});

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

async function runScriptAndValidatePlot(app: Application, script: string, locator: string, RWeb = false) {
	await app.workbench.console.pasteCodeToConsole(script);
	await app.workbench.console.sendEnterKey();
	await app.workbench.layouts.enterLayout('fullSizedAuxBar');
	await app.workbench.plots.waitForWebviewPlot(locator, 'visible', RWeb);
}

async function compareImages({
	app,
	buffer,
	diffScreenshotName,
	masterScreenshotName,
	testInfo
}: {
	app: any;
	buffer: Buffer;
	diffScreenshotName: string;
	masterScreenshotName: string;
	testInfo: any;
}) {
	await test.step('compare images', async () => {
		if (process.env.GITHUB_ACTIONS && !app.web) {
			const data = await resembleCompareImages(fs.readFileSync(path.join(__dirname, `${masterScreenshotName}.png`),), buffer, options);

			if (data.rawMisMatchPercentage > 2.0) {
				if (data.getBuffer) {
					await testInfo.attach(diffScreenshotName, { body: data.getBuffer(true), contentType: 'image/png' });
				}

				// Capture a new master image in CI
				const newMaster = await app.workbench.plots.currentPlot.screenshot();
				await testInfo.attach(masterScreenshotName, { body: newMaster, contentType: 'image/png' });

				// Fail the test with mismatch details
				fail(`Image comparison failed with mismatch percentage: ${data.rawMisMatchPercentage}`);
			}
		}
	});
}

const pythonDynamicPlot = `import pandas as pd
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


const pythonStaticPlot = `import graphviz as gv
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

const pythonPlotActions1 = `import graphviz as gv
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

const pythonPlotActions2 = `import matplotlib.pyplot as plt

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

// modified snippet from https://www.geeksforgeeks.org/python-pandas-dataframe/
const savePlot = `import pandas as pd
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


const bgplot = `import bqplot.pyplot as bplt
import numpy as np

x = np.linspace(-10, 10, 100)
y = np.sin(x)
axes_opts = {"x": {"label": "X"}, "y": {"label": "Y"}}

fig = bplt.figure(title="Line Chart")
line = bplt.plot(
	x=x, y=y, axes_options=axes_opts
)

bplt.show()`;

const ipydatagrid = `import pandas as pd
from ipydatagrid import DataGrid
data= pd.DataFrame({"A": [1, 2, 3], "B": [4, 5, 6]}, index=["One", "Two", "Three"])
DataGrid(data)
DataGrid(data, selection_mode="cell", editable=True)`;

const ipyleaflet = `from ipyleaflet import Map, Marker, display
center = (52.204793, 360.121558)
map = Map(center=center, zoom=12)

# Add a draggable marker to the map
# Dragging the marker updates the marker.location value in Python
marker = Marker(location=center, draggable=True)
map.add_control(marker)

display(map)`;

const plotly = `import hvplot.pandas
import pandas as pd
hvplot.extension('plotly')
pd.DataFrame(dict(x=[1,2,3], y=[4,5,6])).hvplot.scatter(x="x", y="y")`;

const ipytree = `from ipytree import Tree, Node
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

const ipywidgetOutput = `import ipywidgets
output = ipywidgets.Output()
output`;

const bokeh = `from bokeh.plotting import figure, output_file, show

# instantiating the figure object
graph = figure(title = "Bokeh Line Graph")

# the points to be plotted
x = [1, 2, 3, 4, 5]
y = [5, 4, 3, 2, 1]

# plotting the line graph
graph.line(x, y)

# displaying the model
show(graph)`;

const rBasicPlot = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

const rSavePlot = `cars <- c(1, 3, 6, 4, 9)
plot(cars, type="o", col="blue")
title(main="Autos", col.main="red", font.main=4)`;

const rplot = `library('corrr')

x <- correlate(mtcars)
rplot(x)

# Common use is following rearrange and shave
x <- rearrange(x, absolute = FALSE)
x <- shave(x)
rplot(x)
rplot(x, print_cor = TRUE)
rplot(x, shape = 20, colors = c("red", "green"), legend = TRUE)`;

const highcharter = `library(highcharter)

data("mpg", "diamonds", "economics_long", package = "ggplot2")

hchart(mpg, "point", hcaes(x = displ, y = cty, group = year))`;

const leaflet = `library(leaflet)
m = leaflet() %>% addTiles()
m = m %>% setView(-93.65, 42.0285, zoom = 17)
m %>% addPopups(-93.65, 42.0285, 'Here is the <b>Department of Statistics</b>, ISU')`;

const rPlotly = `library(plotly)
fig <- plot_ly(midwest, x = ~percollege, color = ~state, type = "box")
fig`;
