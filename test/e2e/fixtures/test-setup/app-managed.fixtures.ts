/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, createApp } from '../../infra';
import { AppFixtureOptions } from './app.fixtures';

/**
 * Managed Positron app (Electron or browser-based)
 * Projects: e2e-electron, e2e-chromium/firefox/webkit/edge (port 9000)
 */
export async function ManagedApp(
	fixtureOptions: AppFixtureOptions
): Promise<{ app: Application; start: () => Promise<void>; stop: () => Promise<void> }> {
	const { options } = fixtureOptions;

	const app = createApp(options);

	const start = async () => {
		await app.start();
		await app.workbench.sessions.expectNoStartUpMessaging();
	};

	const stop = async () => {
		await app.stop();
	}

	return { app, start, stop };
}
