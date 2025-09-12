/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import { CustomTestOptions } from './test/e2e/tests/_test.setup';
import type { GitHubActionOptions } from '@midleman/github-actions-reporter';
import { currentsReporter, CurrentsFixtures, CurrentsWorkerFixtures } from '@currents/playwright';

// Merge Currents Fixtures into CustomTestOptions
type ExtendedTestOptions = CustomTestOptions & CurrentsFixtures & CurrentsWorkerFixtures;

process.env.PW_TEST = '1';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig<ExtendedTestOptions>({
	captureGitInfo: { commit: true, diff: true },
	globalSetup: './test/e2e/tests/_global.setup.ts',
	testDir: './test/e2e',
	testIgnore: [
		'example.test.ts'
	],
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
	expect: {
		timeout: 15000,
	},
	reporter: process.env.CI
		? [
			// eslint-disable-next-line local/code-no-dangerous-type-assertions
			['@midleman/github-actions-reporter', <GitHubActionOptions>{
				title: '',
				useDetails: true,
				showError: true,
				showAnnotations: false,
				includeResults: ['fail', 'flaky']
			}],
			['junit', { outputFile: 'test-results/junit.xml' }],
			['list'], ['html'], ['blob'],
			...(process.env.ENABLE_CURRENTS_REPORTER !== 'false'
				? [currentsReporter({
					ciBuildId: process.env.CURRENTS_CI_BUILD_ID || Date.now().toString(),
					recordKey: process.env.CURRENTS_RECORD_KEY || '',
					projectId: 'ZOs5z2',
					disableTitleTags: true,
				})]
				: [])
		]
		: [
			['list'],
			['html', { open: 'on-failure' }],
		],


	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		headless: false,
		trace: 'off', // we are manually handling tracing in _test.setup.ts
		actionTimeout: 15000,
		navigationTimeout: 15000,
		currentsFixturesEnabled: !!process.env.CI,
	},

	projects: [
		{
			name: 'e2e-electron',
			use: {
				web: false,
				artifactDir: 'e2e-electron'
			},
			grepInvert: /@:web-only/
		},
		{
			name: 'e2e-browser',
			use: {
				web: true,
				artifactDir: 'e2e-browser',
				headless: false,
			},
			grep: /@:web/
		},
		{
			name: 'e2e-browser-external',
			use: {
				web: true,
				artifactDir: 'e2e-browser-external',
				headless: false,
				useExternalServer: true,
				externalServerUrl: 'http://localhost:8080/?tkn=dev-token'
			},
			grep: /@:web|@:external/
		},
		{
			name: 'e2e-windows',
			use: {
				web: false,
				artifactDir: 'e2e-windows',
			},
			grep: /@:win/,
			grepInvert: /@:web-only/
		},
		{
			name: 'e2e-macOS-ci',
			use: {
				web: false,
				artifactDir: 'e2e-macOS-ci',
			},
			grep: /@:win/,
			grepInvert: /@:web-only|@:interpreter/
		},
	],
});
