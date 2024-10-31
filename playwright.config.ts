/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { defineConfig, devices, PlaywrightTestConfig } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

type TestOptions = {
	web: boolean;
	artifactDir: string;
};

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<TestOptions>({
	globalSetup: require.resolve('./test/smoke/global-setup.ts'),
	testDir: './test/smoke/src/e2e',
	testMatch: '*.test.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: 3, // Number of parallel workers (tests will run in parallel)
	reporter: [['html', { open: 'always' }]],
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		// baseURL: 'http://127.0.0.1:3000',
		headless: false,
		trace: 'off',
		// video: 'on'
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: 'e2e-electron',
			use: {
				...devices['Desktop Chrome'],
				web: false,
				artifactDir: 'e2e-electron'
			},
		},
		{
			name: 'e2e-browser',
			use: {
				...devices['Desktop Chrome'],
				web: true,
				artifactDir: 'e2e-browser'
			},
			grep: /@web/
		},
	],
});
