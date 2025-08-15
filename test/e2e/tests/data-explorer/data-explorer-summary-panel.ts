/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/*
Summary:
- This test suite verifies the Copy as Code behavior for Data Explorer tables in both Python and R environments.
- Ensures basic filters (e.g. "is not null", "contains") are applied correctly across supported data frame types.
- Confirms the filtered result is exported in the correct syntax for each language/library combination.
*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Data Explorer: Summary Panel', { tag: [tags.WIN, tags.DATA_EXPLORER] }, () => {

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'dataExplorer.summaryPanelEnhancements': true
		});
	});

	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});


	test('Summary Panel: Search', async function ({ app, hotKeys, openFile, python }) {
		const { variables, dataExplorer } = app.workbench;

		// open a file that contains a DataFrame
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await hotKeys.runFileInConsole();

		// open the DataFrame in the Data Explorer
		await variables.doubleClickVariableRow('df');
		await dataExplorer.waitForIdle();
		await hotKeys.closeSecondarySidebar();
		await dataExplorer.summaryPanel.expectColumnCountToBe(12); // how many fit in window

		// perform basic search
		await dataExplorer.summaryPanel.search('flight');
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);
		// await dataExplorer.summaryPanel.expectScrollbarToBeVisible(false)

		// verify collapse and expand retains search
		await dataExplorer.summaryPanel.expandColumnProfile();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.hide()
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0)
		await dataExplorer.summaryPanel.show();
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.expectColumnCountToBe(1);

		// clear search
		await dataExplorer.summaryPanel.clearSearch()
		await dataExplorer.summaryPanel.expectColumnProfileToBeExpanded(0);
		await dataExplorer.summaryPanel.expectScrollbarToBeVisible(true);

		// search with no results
		await dataExplorer.summaryPanel.search('snickerdoodle');
		await dataExplorer.summaryPanel.expectColumnCountToBe(0);
		// await dataExplorer.summaryPanel.expectEmptyState();
		// await dataExplorer.summaryPanel.expectScrollbarToBeVisible(false)
	});

	test('Summary Panel: Sort', async function ({ app, hotKeys, openFile, python }) {
		const { variables, dataExplorer } = app.workbench;

		// await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-33million.py'));
		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));
		await hotKeys.runFileInConsole();
		// await variables.doubleClickVariableRow('df_large');
		await variables.doubleClickVariableRow('df');
		await dataExplorer.waitForIdle();
		await hotKeys.closeSecondarySidebar();

		// basic sorting
		await dataExplorer.summaryPanel.sortBy('Name, Ascending');
		await dataExplorer.summaryPanel.expectSortToBeBy('Name, Ascending');
	});
});


// const parquet4MilRows = `
// library(arrow)
// library(dplyr)

// # Set timezone if needed
// Sys.setenv(TZ = 'UTC')

// # Construct path to the original dataset
// flights_path <- file.path(getwd(), "data-files", "flights", "flights.parquet")

// # Read the ~1M row flights parquet
// df <- read_parquet(flights_path)
// cat("Original row count:", nrow(df), "\n")

// # Multiply rows by 4x
// df_4x <- df[rep(seq_len(nrow(df)), times = 4), ]

// # Optional: Add a row ID for debugging/tracing in Positron
// df_4x <- df_4x %>%
//   mutate(row_id = row_number())

// # Write to a new Parquet file
// output_path <- file.path(getwd(), "data-files", "flights", "flights_4x.parquet")
// write_parquet(df_4x, output_path)

// cat("✅ Wrote", nrow(df_large), "rows to:", output_path, "\n")`
