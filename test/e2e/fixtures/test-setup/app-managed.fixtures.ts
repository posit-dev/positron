/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { setFixtureScreenshot, moveAndOverwrite } from './shared-utils.js';

/**
 * App fixture for managed servers (both Electron and browser-based apps)
 * Projects: e2e-electron, e2e-browser (port 9000)
 */
export function ManagedAppFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: Application) => Promise<void>) => {
		const { options, logsPath, logger, workerInfo } = fixtureOptions;

		const app = createApp(options);

		try {
			await app.start();
			await app.workbench.sessions.expectNoStartUpMessaging();

			await use(app);
		} catch (error) {
			// capture a screenshot on failure
			const screenshotPath = path.join(logsPath, 'app-start-failure.png');
			try {
				const page = app.code?.driver?.page;
				if (page) {
					const screenshot = await page.screenshot({ path: screenshotPath });
					setFixtureScreenshot(screenshot);
				}
			} catch {
				// ignore
			}

			throw error; // re-throw the error to ensure test failure
		} finally {
			await app.stop();

			// rename the temp logs dir to the spec name (if available)
			await moveAndOverwrite(logger, logsPath, workerInfo);
		}
	};
}
