/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { mkdir } from 'fs/promises';
import * as os from 'os';
import { Application, createApp, copyFixtureFile } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { renameTempLogsDir, copyUserSettings, captureScreenshotOnError } from './shared-utils';

/**
 * External Positron server fixture (port 8080)
 * Projects: e2e-browser-server
 */
export function ExternalPositronServerFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: Application) => Promise<void>) => {
		const { options, logsPath, logger, workerInfo } = fixtureOptions;

		// For external server mode, use the server's actual user data directory
		const serverUserDataDir = join(os.homedir(), '.positron-e2e-test');
		const userDir = join(serverUserDataDir, 'User');
		await mkdir(userDir, { recursive: true });

		// Copy custom keybindings and settings to the server user data dir
		await copyFixtureFile('keybindings.json', userDir, true);
		await copyUserSettings(userDir);

		const app = createApp(options);

		try {
			await app.connectToExternalServer();
			await app.workbench.sessions.expectNoStartUpMessaging();
			await app.workbench.hotKeys.closeAllEditors();
			await app.workbench.sessions.deleteAll();

			await use(app);
		} catch (error) {
			await captureScreenshotOnError(app, logsPath, error);
			throw error; // re-throw the error to ensure test failure
		} finally {
			await app.stopExternalServer();
			await renameTempLogsDir(logger, logsPath, workerInfo);
		}
	};
}
