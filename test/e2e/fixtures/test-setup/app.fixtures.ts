/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { Application, ApplicationOptions, MultiLogger } from '../../infra';
import { startManagedApp } from './app-managed.fixtures';
import { startExternalPositronServerApp } from './app-external.fixtures';
import { startWorkbenchApp } from './app-workbench.fixtures';

export interface AppFixtureOptions {
	options: ApplicationOptions;
	logsPath: string;
	logger: MultiLogger;
	workerInfo: playwright.WorkerInfo;
}

/**
 * Main app fixture that routes to the appropriate implementation based on configuration
 */
export async function AppFixture(fixtureOptions: AppFixtureOptions): Promise<Application> {
	const project = fixtureOptions.workerInfo.project.name;

	// Start the appropriate app based on the project name
	// e2e-workbench -> Workbench (Docker)
	// e2e-server -> External Positron server
	// All others -> Managed (Electron or browser-based)
	if (project === 'e2e-workbench') {
		return await startWorkbenchApp(fixtureOptions);
	} else if (project.includes('server')) {
		return await startExternalPositronServerApp(fixtureOptions);
	} else {
		return await startManagedApp(fixtureOptions);
	}
}

// Re-export the options fixtures for convenience
export { OptionsFixture, UserDataDirFixture } from './options.fixtures';
export { CustomTestOptions } from './options.fixtures';
