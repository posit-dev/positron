/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import { CustomTestOptions } from './test/smoke/src/areas/positron/_test.setup';
import type { GitHubActionOptions } from '@estruyf/github-actions-reporter';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<CustomTestOptions>({
	globalSetup: require.resolve('./test/smoke/src/areas/positron/_global.setup.ts'),
	testDir: './test/smoke/src/areas/positron',
	testMatch: '*.test.ts',
	fullyParallel: false, // Run individual tests w/in a spec in parallel
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 3, // Number of parallel workers
	timeout: 2 * 60 * 1000,
	reportSlowTests: {
		max: 10,
		threshold: 60 * 1000, // 1 minute
	},
	reporter: process.env.CI
		? [
			['@estruyf/github-actions-reporter', <GitHubActionOptions>{
				title: '',
				useDetails: true,
				showError: true,
				includeResults: ['fail', 'flaky']
			}],
			['junit', { outputFile: 'test-results/junit.xml' }],
			['dot'], ['html'], ['blob']
		]
		: [
			['list'],
			['html', { open: 'on-failure' }],
			[
				'./node_modules/playwright-slack-report/dist/src/SlackReporter.js',
				{
					channels: ['pw-tests', 'ci'], // provide one or more Slack channels
					sendResults: 'always', // "always" , "on-failure", "off"
				},
			],
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
			name: 'e2e-browser',
			use: {
				web: true,
				artifactDir: 'e2e-browser',
				headless: false,
			},
			grep: /@web/
		},
	],
});
