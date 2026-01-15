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
		// --- Start Positron ---
		// Try graceful session shutdown with timeout to avoid blocking teardown
		try {
			await Promise.race([
				app.workbench.sessions.deleteAll(),
				new Promise((_, reject) => setTimeout(() => reject(new Error('Session cleanup timeout')), 3000))
			]);
			// Brief wait for kernel processes to fully terminate
			await new Promise(resolve => setTimeout(resolve, 500));
		} catch (error) {
			// Don't fail teardown if session cleanup fails/times out
			// The process tree kill will handle any remaining processes
			console.log('Session cleanup skipped or timed out:', error instanceof Error ? error.message : 'unknown error');
		}
		// --- End Positron ---

		await app.stop();
	}

	return { app, start, stop };
}
