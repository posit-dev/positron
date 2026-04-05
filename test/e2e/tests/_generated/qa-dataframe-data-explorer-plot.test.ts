/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('QA: DataFrame in Data Explorer with summary panel and matplotlib plot', async ({ app }) => {
	const { sessions, console, variables, dataExplorer, plots, layouts } = app.workbench;

	// Start Python and create a DataFrame
	await sessions.start('python');
	await console.executeCode('Python', [
		'import pandas as pd',
		'df = pd.DataFrame({"name": ["Alice", "Bob", "Charlie"], "age": [30, 25, 35], "score": [85.5, 92.0, 78.3]})',
	].join('\n'));

	// Open DataFrame in Data Explorer and verify summary panel
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.maximize(true);
	await dataExplorer.summaryPanel.expectColumnCountToBe(3);
	await dataExplorer.summaryPanel.expandColumnProfile(0);
	await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);

	// Create a matplotlib plot and verify it renders
	await console.executeCode('Python', [
		'import matplotlib.pyplot as plt',
		'plt.figure()',
		'plt.bar(df["name"], df["score"])',
		'plt.title("Scores by Name")',
		'plt.show()',
	].join('\n'));
	await layouts.enterLayout('stacked');
	await plots.waitForCurrentPlot();
});
