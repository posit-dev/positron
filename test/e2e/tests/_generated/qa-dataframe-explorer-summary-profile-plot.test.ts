/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from './_qa.setup';

test.use({ suiteId: __filename });

test('QA: DataFrame with Data Explorer summary panel and matplotlib plot', async function ({ app, python }) {
	const { console, variables, dataExplorer, plots } = app.workbench;

	// Create a DataFrame with 3 columns
	await console.executeCode('Python', [
		'import pandas as pd',
		'import matplotlib.pyplot as plt',
		'',
		'df = pd.DataFrame({',
		'    "name": ["Alice", "Bob", "Charlie", "Diana", "Eve"],',
		'    "age": [25, 30, 35, 28, 32],',
		'    "score": [88.5, 92.1, 76.3, 95.0, 81.7]',
		'})',
	].join('\n'));

	// Open DataFrame in Data Explorer and verify summary panel
	await variables.openVariableInDataExplorer('df');
	await dataExplorer.waitForIdle();
	await dataExplorer.summaryPanel.show();
	await dataExplorer.summaryPanel.expandColumnProfile(0);
	await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);

	// Create a matplotlib plot and verify it appears
	await console.executeCode('Python', [
		'plt.plot(df["age"], df["score"])',
		'plt.xlabel("Age")',
		'plt.ylabel("Score")',
		'plt.title("Age vs Score")',
		'plt.show()',
	].join('\n'));
	await plots.waitForCurrentPlot();
});
