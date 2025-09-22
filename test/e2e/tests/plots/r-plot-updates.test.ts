/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { fail } from 'assert';
import { test, tags } from '../_test.setup';


test.use({
	suiteId: __filename
});

test.describe('Plots', { tag: [tags.PLOTS, tags.EDITOR] }, () => {
	test.describe('R Plots', {
		tag: [tags.ARK]
	}, () => {

		test('R - plot should not be updated after initial appearance', { tag: [tags.WEB, tags.WIN] }, async function ({ app, r }) {

			// debug - uncomment so that test plot is second plot
			// await app.workbench.console.executeCode('R', 'plot(1)');
			// await app.workbench.plots.waitForCurrentPlot();

			await app.positron.console.executeCode('R', 'plot(rexp(50000))');
			await app.positron.plots.waitForCurrentPlot();

			try {
				await waitForNoChangesAtLocator(app.code.driver.page, '.plot-instance img', 10000);
				console.log('No changes detected for 10 seconds');
			} catch (error) {
				fail('Changes detected within the specified duration');
			}

		});

	});
});


async function waitForNoChangesAtLocator(page, selector: string, duration: number = 10000): Promise<void> {
	await page.evaluate(
		({ selector, duration }) => {
			return new Promise<void>((resolve, reject) => {
				const targetElement = document.querySelector(selector);
				if (!targetElement) {
					reject(new Error('Target element not found'));
					return;
				}

				let timeoutId: NodeJS.Timeout;
				const observer = new MutationObserver((mutationsList) => {
					if (mutationsList.length > 0) {
						observer.disconnect();
						clearTimeout(timeoutId);
						reject(new Error('Changes detected within the specified duration'));
					}
				});

				observer.observe(targetElement, {
					childList: true,    // Detect child node additions/removals
					attributes: true,   // Detect attribute changes
					subtree: true,      // Detect changes in all descendant nodes
					characterData: true // Detect text content changes
				});

				// If no changes are detected within the duration, resolve
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve();
				}, duration);
			});
		},
		{ selector, duration }
	);
}
