/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { Application, ApplicationOptions, MultiLogger } from '../../infra';
import { ManagedApp } from './app-managed.fixtures';
import { ExternalPositronServerApp } from './app-external.fixtures';
import { WorkbenchApp } from './app-workbench.fixtures';
import { JupyterApp } from './app-jupyter.fixtures';

export interface AppFixtureOptions {
	options: ApplicationOptions;
	logsPath: string;
	logger: MultiLogger;
	workerInfo: playwright.WorkerInfo;
	managedCredentials?: 'snowflake' | 'databricks' | 'azure';
	/**
	 * When true, suites opt into the legacy (VS Code) notebook editor. The local
	 * (Electron/managed) apps apply this via the host `settingsFile` in `beforeApp`,
	 * but the Docker-based apps (Jupyter, Workbench) read settings copied into the
	 * container, so they must merge the override in themselves.
	 */
	useLegacyNotebookEditor?: boolean;
	/**
	 * When true, suites opt into the Data Connections preview panel. As with
	 * `useLegacyNotebookEditor`, the local apps apply this via the host `settingsFile`
	 * in `beforeApp`, while the Docker-based apps merge the override into the settings
	 * copied into the container.
	 */
	enableDataConnections?: boolean;
	/**
	 * When true, suites opt into the Microsoft Foundry (msFoundry) assistant
	 * provider, authenticated via Posit Workbench managed credentials. As with
	 * the other override flags, the local apps apply this via the host
	 * `settingsFile` in `beforeApp`, while the Docker-based apps merge the
	 * settings into the container settings.
	 */
	enableFoundryAssistant?: boolean;
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
	} else if (project === 'e2e-jupyter') {
		return await JupyterApp(fixtureOptions);
	} else if (project.includes('server')) {
		return await ExternalPositronServerApp(fixtureOptions);
	} else {
		return await ManagedApp(fixtureOptions);
	}
}

// Re-export the options fixtures for convenience
export { OptionsFixture, UserDataDirFixture } from './options.fixtures';
export { CustomTestOptions } from './options.fixtures';
