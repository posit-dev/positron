/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA: DataFrame, Data Explorer summary panel, column profile, and matplotlib plot', async function ({ app, python }) {
	const { console, variables, dataExplorer, plots } = app.workbench;

	// Create a DataFrame with 3 columns
	await console.executeCode('Python', [
		'import pandas as pd',
		'df = pd.DataFrame({"name": ["Alice", "Bob", "Charlie"], "age": [30, 25, 35], "score": [88.5, 92.3, 76.1]})',
	].join('\n'));
	await variables.expectVariableToBe('df', '[3 rows x 3 columns] pandas.DataFrame');

	// Open in Data Explorer and verify columns
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.waitForIdle();
	await dataExplorer.grid.expectColumnHeadersToBe(['name', 'age', 'score']);

	// Show summary panel and expand a column profile
	await dataExplorer.summaryPanel.show();
	await dataExplorer.summaryPanel.expectColumnCountToBe(3);
	await dataExplorer.summaryPanel.expandColumnProfile(0);
	await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);

	// Create a matplotlib plot and verify it appears
	await console.executeCode('Python', [
		'import matplotlib.pyplot as plt',
		'plt.figure()',
		'plt.bar(df["name"], df["score"])',
		'plt.title("Scores by Name")',
		'plt.show()',
	].join('\n'));
	await plots.waitForCurrentPlot();
	await plots.expectCurrentPlotVisible();
});
