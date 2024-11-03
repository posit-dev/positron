/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import { CustomTestOptions } from './test/smoke/e2e/_test.setup';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });


/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<CustomTestOptions>({
	globalSetup: require.resolve('./test/smoke/e2e/_global.setup.ts'),
	testDir: './test/smoke/e2e',
	testMatch: '*.test.ts',
	fullyParallel: false, // Run individual tests in parallel
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 0 : 0,
	workers: 3, // Number of parallel workers (tests will run in parallel)
	timeout: 2 * 60 * 1000, // test timeout is 2 minutes
	reportSlowTests: {
		max: 10,
		threshold: 60 * 1000, // 1 minute
	},
	reporter: process.env.CI
		? [
			['github'],
			['junit', { outputFile: 'test-results/results.xml' }],
			['html']
		]
		: [
			['list'],
			['html', { open: 'on-failure' }]
		],


	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		headless: false,
		trace: 'off', // we are manually handling tracing in _test.setup.ts
	},

	projects: [
		{
			name: 'e2e-electron',
			use: {
				web: false,
				artifactDir: 'e2e-electron'
			},
		},
		{
			name: 'e2e-chromium',
			use: {
				web: true,
				artifactDir: 'e2e-chromium',
				headless: true,
			},
			grep: /@web/
		},
	],
});
