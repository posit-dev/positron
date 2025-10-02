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
 * Start and connect to an external Positron server (port 8080)
 * Projects: e2e-server
 */
export async function startExternalPositronServerApp(fixtureOptions: AppFixtureOptions): Promise<Application> {
	const { options } = fixtureOptions;
	let error: unknown = undefined;

	const app = createApp(options);

	try {
		// For external server mode, use the server's actual user data directory
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
	} catch (err) {
		console.error('Error during app start or session check:', err);
		error = err;
	}

	if (error) {
		// Throw after returning, so we have time to capture screenshot and trace
		setTimeout(() => { throw error; }, 1000);
	}

	return app;
}
