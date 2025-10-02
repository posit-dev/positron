/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { Application, ApplicationOptions, MultiLogger } from '../../infra';
import { ManagedApp } from './app-managed.fixtures';
import { ExternalPositronServerApp } from './app-external.fixtures';
import { WorkbenchApp } from './app-workbench.fixtures';

export interface AppFixtureOptions {
	options: ApplicationOptions;
	logsPath: string;
	logger: MultiLogger;
	workerInfo: playwright.WorkerInfo;
}

/**
 * Main app fixture that routes to the appropriate implementation based on configuration
 */
export async function AppFixture(fixtureOptions: AppFixtureOptions): Promise<{
	app: Application;
	start: () => Promise<void>;
	stop: () => Promise<void>;
}> {
	const project = fixtureOptions.workerInfo.project.name;

	if (project === 'e2e-workbench') {
		return await WorkbenchApp(fixtureOptions);
	} else if (project.includes('server')) {
		return await ExternalPositronServerApp(fixtureOptions);
	} else {
		return await ManagedApp(fixtureOptions);
	}
}

// Re-export the options fixtures for convenience
export { OptionsFixture, UserDataDirFixture } from './options.fixtures';
export { CustomTestOptions } from './options.fixtures';
