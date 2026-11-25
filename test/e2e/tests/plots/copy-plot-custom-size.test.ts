/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../_test.setup';
import { Application } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Plots: Copy Plot at Custom Size', {
	tag: [tags.PLOTS]
}, () => {

	test.afterEach(async function ({ app, hotKeys }) {
		await expect(async () => {
			await hotKeys.clearPlots();
			await app.workbench.plots.waitForNoPlots({ timeout: 3000 });
		}).toPass({ timeout: 15000 });
	});

	const copyAtCustomSize = async (app: Application) => {
		const { plots, clipboard } = app.workbench;
		await plots.waitForCurrentPlot();
		await app.workbench.toasts.closeAll();
		const srcBefore = await plots.getCurrentPlotSrc();
		await clipboard.clearClipboard();

		await plots.copyCurrentPlotAtCustomSize({ width: 500, height: 400 });

		// The dialog starts at the smallest default resolution (1x, 2x, 3x) at least the screen's.
		const ratio = await plots.getDevicePixelRatio();
		const resolution = [1, 2, 3].find(r => r >= ratio) ?? 3;
		await expect.poll(() => clipboard.getClipboardImageSize()).toEqual({
			width: 500 * resolution,
			height: 400 * resolution
		});
		expect(await plots.getCurrentPlotSrc()).toBe(srcBefore);
	};

	test('R - copy plot at custom size puts a plot of that size on the clipboard', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.workbench.console.executeCode('R', 'plot(1:10)');
		await copyAtCustomSize(app);
	});

	test('Python - copy plot at custom size puts a plot of that size on the clipboard', {
		tag: [tags.PYTHON]
	}, async function ({ app, python }) {
		const code = `
import matplotlib.pyplot as plt
plt.plot([1, 2, 3, 4], [1, 4, 9, 16])
plt.show()`;
		await app.workbench.console.executeCode('Python', code);
		await copyAtCustomSize(app);
	});
});
