/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { renameTempLogsDir, captureScreenshotOnError } from './shared-utils.js';

/**
 * App fixture for managed servers (both Electron and browser-based apps)
 * Projects: e2e-electron, e2e-chromium/firefox/webkit (port 9000)
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
			await captureScreenshotOnError(app, logsPath, error);
			throw error; // re-throw the error to ensure test failure
		} finally {
			await app.stop();
			await renameTempLogsDir(logger, logsPath, workerInfo);
		}
	};
}
