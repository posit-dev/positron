/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { ApplicationOptions, MultiLogger } from '../../infra';
import { ManagedAppFixture } from './app-managed.fixtures';
import { ExternalPositronServerFixture } from './app-external.fixtures';
import { WorkbenchAppFixture } from './app-workbench.fixtures';

export interface AppFixtureOptions {
	options: ApplicationOptions;
	logsPath: string;
	logger: MultiLogger;
	workerInfo: playwright.WorkerInfo;
}

/**
 * Main app fixture that routes to the appropriate implementation based on configuration
 */
export function AppFixture() {
	return async (fixtureOptions: AppFixtureOptions, use: (arg0: any) => Promise<void>) => {
		const project = fixtureOptions.workerInfo.project.name;

		// Route to the appropriate fixture based on configuration
		if (project === 'e2e-workbench') {
			return await WorkbenchAppFixture()(fixtureOptions, use);
		} else if (project.includes('server')) {
			return await ExternalPositronServerFixture()(fixtureOptions, use);
		} else {
			return await ManagedAppFixture()(fixtureOptions, use);
		}
	};
}

// Re-export the options fixtures for convenience
export { OptionsFixture, UserDataDirFixture } from './options.fixtures';
export { CustomTestOptions } from './options.fixtures';
