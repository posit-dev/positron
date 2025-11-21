/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import { CustomTestOptions } from './test/e2e/tests/_test.setup';
import { currentsReporter, CurrentsFixtures, CurrentsWorkerFixtures } from '@currents/playwright';

// Merge Currents Fixtures into CustomTestOptions
type ExtendedTestOptions = CustomTestOptions & CurrentsFixtures & CurrentsWorkerFixtures;

process.env.PW_TEST = '1';
const jsonOut = process.env.PW_JSON_FILE || 'test-results/results.json';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const projectName = process.env.PW_PROJECT_NAME || 'default';

export default defineConfig<ExtendedTestOptions>({
	captureGitInfo: { commit: true, diff: true },
	globalSetup: './test/e2e/tests/_global.setup.ts',
	testDir: './test/e2e',
	testMatch: '*.test.ts',
	shardingMode: 'duration-round-robin',
	// @ts-expect-error shardingMode and lastRunFile added by playwright patch
	lastRunFile: `./blob-report/.last-run-${projectName}.json`,
	testIgnore: [
		'example.test.ts',
		'**/workbench/**',
		'**/inspect-ai/**',
		'**/remote-ssh/**'
	],
	fullyParallel: false, // Run individual tests w/in a spec in parallel
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 3,
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
			['@midleman/github-actions-reporter'],
			['json', { outputFile: jsonOut }],
			['list'], ['html'], ['blob'],
			...(process.env.ENABLE_CURRENTS_REPORTER === 'true'
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
				artifactDir: 'e2e-electron'
			},
			grepInvert: /@:web-only/
		},
		{
			name: 'e2e-chromium',
			use: {
				artifactDir: 'e2e-chromium',
				headless: false,
				browserName: 'chromium'
			},
			grep: /@:web/
		},
		{
			name: 'e2e-firefox',
			use: {
				artifactDir: 'e2e-firefox',
				headless: false,
				browserName: 'firefox'
			},
		},
		{
			name: 'e2e-windows',
			use: {
				artifactDir: 'e2e-windows',
			},
			grep: /@:win/,
			grepInvert: /@:web-only/
		},
		{
			name: 'e2e-webkit',
			use: {
				artifactDir: 'e2e-webkit',
				headless: false,
				browserName: 'webkit'
			},
			grep: /@:web/
		},
		{
			name: 'e2e-edge',
			use: {
				artifactDir: 'e2e-edge',
				headless: false,
				browserName: 'chromium',
				channel: 'msedge',
			},
			grep: /@:web/
		},
		{
			name: 'e2e-server',
			use: {
				artifactDir: 'e2e-server',
				headless: false,
				useExternalServer: true,
				externalServerUrl: 'http://localhost:8080/?tkn=dev-token',
				browserName: 'chromium'
			},
			grep: /@:web/
		},
		{
			name: 'e2e-macOS-ci',
			use: {
				artifactDir: 'e2e-macOS-ci',
			},
			grep: /@:win/,
			grepInvert: /@:web-only|@:interpreter/
		},
		{
			name: 'inspect-ai',
			testIgnore: [
				'example.test.ts',
				'**/workbench/**',
			],
			use: {
				artifactDir: 'inspect-ai',
			},
			grep: /@:inspect-ai/
		},
		{
			name: 'e2e-workbench',
			testIgnore: [
				'example.test.ts',
				'**/inspect-ai/**'
			],
			use: {
				artifactDir: 'e2e-workbench',
				headless: false,
				useExternalServer: true,
				externalServerUrl: 'http://localhost:8787',
				browserName: 'chromium',
			},
			grep: /@:workbench/
		},
		{
			name: 'e2e-remote-ssh',
			testIgnore: [
				'example.test.ts',
				'**/inspect-ai/**'
			],
			use: {
				artifactDir: 'e2e-remote-ssh',
				headless: false,
				useExternalServer: false,
			},
			grep: /@:remote-ssh/
		},
	],
});
