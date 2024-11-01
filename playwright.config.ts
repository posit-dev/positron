/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { defineConfig, devices } from '@playwright/test';

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

// need to not hardcode these values
// process.env.POSITRON_PY_VER_SEL = '3.10.12';
// process.env.POSITRON_R_VER_SEL = '4.4.0';
console.log('!!!!!!', process.env.TEST, process.env.POSITRON_PY_VER_SEL, process.env.POSITRON_R_VER_SEL);

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<TestOptions>({
	globalSetup: require.resolve('./test/smoke/src/e2e/_global.setup.ts'),
	testDir: './test/smoke/src/e2e',
	testMatch: '*.test.ts',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 0 : 0,
	workers: 3, // Number of parallel workers (tests will run in parallel)
	reporter: process.env.CI
		? [
			['github'],
			['junit', { outputFile: 'test-results/results.xml' }],
			['html']
		]
		: [
			['list'],
			['html']
		],
	timeout: 2 * 60 * 1000, // 2 minutes

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
