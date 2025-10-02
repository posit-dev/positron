/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';

/**
 * Start a managed Positron app (Electron or browser-based)
 * Projects: e2e-electron, e2e-chromium/firefox/webkit/edge (port 9000)
 */
export async function startManagedApp(fixtureOptions: AppFixtureOptions): Promise<Application> {
	const { options } = fixtureOptions;
	let error: unknown = undefined;

	const app = createApp(options);

	try {
		await app.start();
		throw new Error('OOPS!');
		await app.workbench.sessions.expectNoStartUpMessaging();
	}
	catch (err) {
		console.error('Error during app start or session check:', err);
		error = err;
	}

	if (error) {
		// Throw after returning, so we have time to capture screenshot and trace
		setTimeout(() => { throw error; }, 1000);
	}

	return app;
}
