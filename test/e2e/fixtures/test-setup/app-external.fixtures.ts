/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { mkdir } from 'fs/promises';
import * as os from 'os';
import { Application, createApp, copyFixtureFile } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';
import { copyUserSettings, } from './shared-utils';

/**
 * External Positron Server (port 8080)
 * Projects: e2e-server
 */
export async function ExternalPositronServerApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options } = fixtureOptions;

	const app = createApp(options);

	const start = async () => {
		const serverUserDataDir = join(os.homedir(), '.positron-e2e-test');
		const userDir = join(serverUserDataDir, 'User');
		await mkdir(userDir, { recursive: true });

		// Copy custom keybindings and settings to the server user data dir
		await copyFixtureFile('keybindings.json', userDir, true);
		await copyUserSettings(userDir);

		// Start the app and connect to the external server
		await app.connectToExternalServer();
		await app.workbench.sessions.expectNoStartUpMessaging();
		await app.workbench.hotKeys.closeAllEditors();
		await app.workbench.sessions.deleteAll();
	};

	const stop = async () => {
		await app.stopExternalServer();
	}

	return { app, start, stop };
}
