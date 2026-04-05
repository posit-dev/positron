/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test('QA: DataFrame in Data Explorer with summary panel and matplotlib plot', async ({ app }) => {
	const { sessions, console, variables, dataExplorer, plots } = app.workbench;

	// Start Python and create a DataFrame with 3 columns
	await sessions.start('python');
	await console.executeCode('Python', [
		'import pandas as pd',
		'df = pd.DataFrame({"name": ["Alice", "Bob", "Charlie"], "age": [30, 25, 35], "score": [85.5, 92.0, 78.3]})',
	].join('\n'));
	await variables.expectVariableToBe('df', '[3 rows x 3 columns] pandas.DataFrame');

	// Open in Data Explorer and show summary panel
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.maximize(true);

	// Expand a column profile and verify it expanded
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
});
