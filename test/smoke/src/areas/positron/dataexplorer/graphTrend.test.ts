/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application, Logger, PositronPythonFixtures } from '../../../../../automation/out';
import { installAllHandlers } from '../../../utils';

export function setup(logger: Logger) {
	describe('Data Explorer #pr', () => {

		installAllHandlers(logger);

		describe('Graph Trend', () => {

			beforeEach(async function () {
				await this.app.workbench.positronLayouts.enterLayout('stacked');
				await PositronPythonFixtures.SetupFixtures(this.app as Application);
			});

			async function openDataExplorerColumnProfile(app: Application) {
				logger.log('Opening data grid');
				await expect(async () => {
					await app.workbench.positronVariables.doubleClickVariableRow('graphData');
					await app.code.driver.getLocator('.label-name:has-text("Data: graphData")').innerText();
				}).toPass();

				logger.log('Expand column profile');
				await app.workbench.positronSideBar.closeSecondarySideBar();
				await app.workbench.positronDataExplorer.expandColumnProfile(0);
			}

			async function verifyGraphBarHeights(app: Application) {
				// Get all graph graph bars/rectangles
				await expect(async () => {
					const rects = app.code.driver.getLocator('rect.count');

					// Iterate over each rect and verify the height
					const expectedHeights = ['50', '40', '30', '20', '10'];
					for (let i = 0; i < expectedHeights.length; i++) {
						const height = await rects.nth(i).getAttribute('height');
						expect(height).toBe(expectedHeights[i]);
					}
				}).toPass({ timeout: 10000 });
			}

			it('Python Pandas - Verifies downward trending graph', async function () {
				const app = this.app as Application;

				logger.log('[Python] Sending code to console');
				await app.workbench.positronConsole.executeCode('Python', pythonScript, '>>>');

				await openDataExplorerColumnProfile(app);
				await verifyGraphBarHeights(app);
			});


			it('R - Verifies downward trending graph', async function () {
				const app = this.app as Application;

				logger.log('[R] Sending code to console');
				await app.workbench.positronConsole.executeCode('R', rScript, '>');

				await openDataExplorerColumnProfile(app);
				await verifyGraphBarHeights(app);
			});
		});
	});
}

const rScript = `library(ggplot2)
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


const pythonScript = `import pandas as pd
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
