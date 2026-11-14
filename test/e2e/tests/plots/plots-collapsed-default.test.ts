/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Plots collapsed by default', {
	tag: [tags.PLOTS, tags.VARIABLES, tags.ARK, tags.WEB, tags.WIN]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await expect(async () => {
			await hotKeys.clearPlots();
			await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
		}).toPass({ timeout: 15000 });
	});

	test('R - Plots starts collapsed and opens to a usable size on the first plot', async function ({ app, r }) {
		const { console, plots, variables } = app.workbench;

		// This suite gets its own app with no saved view state, so this is the
		// registered default and not something an earlier test left behind.
		await plots.expectPlotsPaneToBeExpanded(false);
		await expect(variables.variablesPane.getByText('Variables created in your session appear here.')).toBeVisible();

		await console.executeCode('R', 'plot(cars)');
		await plots.waitForCurrentPlot();

		await plots.expectPlotsPaneToBeExpanded(true);
		// A pane that opens as a sliver shows a plot nobody can read.
		await plots.expectPlotsPaneHeightToBeAtLeast(200);
	});
});
