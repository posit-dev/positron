/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation/out';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Data Explorer', () => {

		installAllHandlers(logger);

		describe('Graph Trend #pr', () => {

			beforeEach(async function () {
				await this.app.workbench.positronLayouts.enterLayout('stacked');
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			it('Python Pandas - Verifies downward trending graph', async function () {
				const app = this.app as Application;

				// Script to create a trending downward bar graph with summarized data
				const script = `import pandas as pd
import matplotlib.pyplot as plt

# Example data with multiple values for the same category
graphData = pd.DataFrame({
'category': ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'E', 'A', 'B', 'C', 'D'],
'values': [1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6]
})

# Summarize data by summing values per category
summarized_data = graphData.groupby('category', as_index=False).sum()

# Create a bar graph
plt.bar(summarized_data['category'], summarized_data['values'], color='steelblue')
plt.xlabel('Category')
plt.ylabel('Total Values')
plt.title('Bar Graph with Summed Values')
plt.show()`;

				logger.log('Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', script, '>>>');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('graphData');
					await app.code.driver.getLocator('.label-name:has-text("Data: graphData")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();
				await app.workbench.positronDataExplorer.expandColumnProfile(0);

				// Get all graph graph bars/rectangles
				const rects = app.code.driver.getLocator('rect.count');
				const expectedHeights = ['50', '40', '30', '20', '10'];

				// Iterate over each rect and verify the height
				for (let i = 0; i < expectedHeights.length; i++) {
					const height = await rects.nth(i).getAttribute('height');
					expect(height).toBe(expectedHeights[i]);
				}
			});


			it('R - Verifies downward trending graph', async function () {
				const app = this.app as Application;

				// Script to create a trending downward bar graph with summarized data
				const script = `library(ggplot2)
library(dplyr)

# Example data with multiple values for the same category
graphData <- tibble(
category = c("A", "A", "A", "A", "B", "B", "B", "C", "C", "D", "E", "A", "B", "C", "D"),
values = c(1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6)
)

# Summarize data by summing values per category
summarized_data <- graphData %>%
group_by(category) %>%
summarise(total_values = sum(values))

# Create a bar graph
ggplot(summarized_data, aes(x = reorder(category, -total_values), y = total_values)) +
geom_bar(stat = "identity", fill = "steelblue") +
labs(x = "Category", y = "Total Values", title = "Bar Graph with Summed Values") +
theme_minimal()`;

				logger.log('Sending code to console');
				await app.workbench.quickaccess.runCommand('workbench.action.toggleDevTools');
				await app.workbench.positronConsole.executeCode('R', script, '>');

				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('graphData');
					await app.code.driver.getLocator('.label-name:has-text("Data: graphData")').innerText();
				}).toPass();

				await app.workbench.positronSideBar.closeSecondarySideBar();
				await app.workbench.positronDataExplorer.expandColumnProfile(0);

				// Get all graph graph bars/rectangles
				const rects = app.code.driver.getLocator('rect.count');
				const expectedHeights = ['50', '40', '30', '20', '10'];

				// Iterate over each rect and verify the height
				for (let i = 0; i < expectedHeights.length; i++) {
					const height = await rects.nth(i).getAttribute('height');
					expect(height).toBe(expectedHeights[i]);
				}
			});
		});
	});
}
