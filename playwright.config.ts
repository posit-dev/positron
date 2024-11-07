/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import { CustomTestOptions } from './test/smoke/src/areas/positron/_test.setup';

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
	globalSetup: require.resolve('./test/smoke/src/areas/positron/_global.setup.ts'),
	testDir: './test/smoke/src/areas/positron',
	testMatch: '*.test.ts',
	fullyParallel: false, // Run individual tests in parallel
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 3, // Number of parallel workers (tests will run in parallel)
	timeout: 1.2 * 60 * 1000,
	reportSlowTests: {
		max: 10,
		threshold: 60 * 1000, // 1 minute
	},
	testIgnore: ['./test/smoke/src/areas/positron/_examples'],
	reporter: process.env.CI
		? [
			['github'],
			['junit', { outputFile: 'test-results/junit.xml' }],
			['blob',]
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
			testIgnore: ['**/_examples/**.test.ts'],
			outputDir: 'test-results/electron',
			use: {
				web: false,
				artifactDir: 'e2e-electron'
			},

		},
		{
			name: 'e2e-browser',
			testIgnore: ['**/_examples/**.test.ts'],
			outputDir: 'test-results/browser',
			use: {
				web: true,
				artifactDir: 'e2e-browser',
				headless: false,
			},
			grep: /@web/
		},
	],
});
