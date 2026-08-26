/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig, ReporterDescription } from '@playwright/test';
import { CustomTestOptions } from './test/e2e/tests/_test.setup';
import { memorySpecsToIgnore } from './test/e2e/utils/memory/scenarios';
import { laneFromEnv } from './test/e2e/utils/memory/lanes';
import * as fs from 'fs';

process.env.PW_TEST = '1';
const jsonOut = process.env.PW_JSON_FILE || 'test-results/results.json';
const githubSummaryReport = process.env.GH_SUMMARY_REPORT === 'true' ? [['@midleman/github-actions-reporter', {}] as const] : [];
// E2E Insights: results reporting + duration-balanced sharding (preprocess
// hook, needs Playwright >= 1.62; no-ops on unsharded runs).
//   ENABLE_CUSTOM_REPORTER=false     -> disables both
//   ENABLE_PREDICTIVE_SHARDING=false -> native shard split, reporting unchanged
const isDisabled = (value?: string) => ['false', '0', 'no'].includes(value?.toLowerCase() ?? '');
const reportingEnabled = !isDisabled(process.env.ENABLE_CUSTOM_REPORTER);
const shardingEnabled = reportingEnabled && !isDisabled(process.env.ENABLE_PREDICTIVE_SHARDING);

const insightsReporters: ReporterDescription[] = [
	...(reportingEnabled
		? [['@midleman/playwright-reporter',
			{
				repoName: 'positron',
				mode: 'prod'
			},
		] as ReporterDescription]
		: []),
	...(shardingEnabled
		? [['@midleman/playwright-reporter/sharding'] as ReporterDescription]
		: []),
];

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const projectName = process.env.PW_PROJECT_NAME || 'default';

// --- Start Positron ---
// A project's own testIgnore REPLACES this one rather than merging with it, so any
// project that declares testIgnore has to spread `rootIgnore` back in. #15737 added a
// memory-spec ignore to e2e-chromium and e2e-server without it, which re-enabled
// example.test.ts and the lsp specs in the web lanes.
// --- End Positron ---
const baseIgnore = [
	'example.test.ts',
	'**/workbench/**',
	'**/connect/**',
	'**/remote-ssh/**',
	'**/remote-wsl/**',
	'**/assistant-eval/**',
	'**/release-screenshots/**',
];

const rootIgnore = process.env.ALLOW_PYREFLY === 'true'
	? baseIgnore
	: [...baseIgnore, '**/lsp/**'];

let reporter: ReporterDescription[];
if (process.env.CI) {
	reporter = [
		...githubSummaryReport,
		...insightsReporters,
		['json', { outputFile: jsonOut }],
		['list'], ['html'], ['blob'],
	];
} else {
	reporter = [['list']];
	if (!process.env.CLAUDE_CODE) {
		reporter.push(['html', { open: 'on-failure' }]);
	}
}

export default defineConfig<CustomTestOptions>({
	captureGitInfo: { commit: true, diff: true },
	globalSetup: './test/e2e/tests/_global.setup.ts',
	globalTeardown: './test/e2e/tests/_global.teardown.ts',
	testDir: './test/e2e',
	testMatch: '*.test.ts',
	testIgnore: rootIgnore,
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
	reporter,


	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		headless: false,
		trace: 'off', // we are manually handling tracing in _test.setup.ts
		actionTimeout: 15000,
		navigationTimeout: 15000,
	},

	projects: [
		{
			name: 'e2e-electron',
			testIgnore: [
				'example.test.ts',
				'**/workbench/**',
				'**/connect/**',
				'**/remote-ssh/**',
				'**/remote-wsl/**',
				// Note: assistant-eval NOT ignored here - runs on e2e-electron only
				...(process.env.ALLOW_PYREFLY === 'true' ? [] : ['**/lsp/**']),
				// Set only by test-memory-metrics.yml, one scenario per matrix job.
				// Ignored rather than skipped in-test because merge-to-main runs this
				// lane ungrepped, so a skip would report a permanently skipped row.
				...memorySpecsToIgnore(laneFromEnv(process.env.MEMORY_LANE), process.env.MEMORY_SCENARIO),
			],
			use: {
				artifactDir: 'e2e-electron'
			},
			grepInvert: /@:web-only/
		},
		{
			name: 'e2e-chromium',
			// --- Start Positron ---
			// The server memory lane runs here, because e2e-chromium takes the
			// spawned-server path that gives the collector a process tree to walk.
			// Without this guard the server memory spec would be eligible in every
			// ordinary @:web run. rootIgnore is spread back in because a project's
			// testIgnore replaces the root one.
			testIgnore: [
				...rootIgnore,
				...memorySpecsToIgnore(laneFromEnv(process.env.MEMORY_LANE), process.env.MEMORY_SCENARIO),
			],
			// --- End Positron ---
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
			grep: /@:cross-browser/
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
			grep: /@:cross-browser/
		},
		{
			name: 'e2e-edge',
			use: {
				artifactDir: 'e2e-edge',
				headless: false,
				browserName: 'chromium',
				channel: 'msedge',
			},
			grep: /@:cross-browser/
		},
		{
			name: 'e2e-server',
			// --- Start Positron ---
			// e2e-server uses an externally started server, so Code holds null in
			// the process slot and there is no tree to walk. A memory spec running
			// here would produce an empty process list rather than an error, so it
			// is excluded unconditionally. rootIgnore is spread back in because a
			// project's testIgnore replaces the root one.
			testIgnore: [
				...rootIgnore,
				...memorySpecsToIgnore(laneFromEnv(process.env.MEMORY_LANE), undefined),
			],
			// --- End Positron ---
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
			name: 'e2e-workbench',
			testIgnore: [
				'example.test.ts',
				'**/assistant-eval/**',
				'**/remote-ssh/**'
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
			// Plain local electron Positron against a standalone Posit Connect
			// container (docker/environments/connect-local). No Workbench: this is
			// the electron coverage for the publisher/connect tests, complementary
			// to the web coverage the e2e-workbench project provides. Its own
			// testIgnore deliberately does NOT list '**/connect/**' (so the moved
			// tests run); grep isolates the suite to @:connect.
			name: 'e2e-connect',
			testIgnore: [
				'example.test.ts',
				'**/workbench/**',
				'**/assistant-eval/**',
				'**/remote-ssh/**',
				'**/remote-wsl/**',
			],
			use: {
				artifactDir: 'e2e-connect',
				headless: false,
				useExternalServer: false,
			},
			// Word-boundary guard: a bare /@:connect/ regex substring-matches
			// '@:connections', pulling the connections suite (Postgres/Snowflake)
			// into this Connect-only lane. Require a non-tag char (or end) after.
			grep: /@:connect(?![\w-])/
		},
		{
			name: 'e2e-remote-ssh',
			testIgnore: [
				'example.test.ts',
				'**/assistant-eval/**',
				'**/workbench/**',
			],
			use: {
				artifactDir: 'e2e-remote-ssh',
				headless: false,
				useExternalServer: false,
			},
			grep: /@:remote-ssh/
		},
		{
			name: 'e2e-remote-wsl',
			testIgnore: [
				'example.test.ts',
				'**/assistant-eval/**',
				'**/workbench/**',
			],
			use: {
				artifactDir: 'e2e-remote-wsl',
				headless: false,
				useExternalServer: false,
			},
			grep: /@:remote-wsl/
		},
		{
			name: 'e2e-jupyter',
			testIgnore: [
				'example.test.ts',
				'**/assistant-eval/**',
				'**/remote-ssh/**'
			],
			use: {
				artifactDir: 'e2e-jupyter',
				headless: false,
				useExternalServer: true,
				externalServerUrl: 'http://localhost:8888',
				browserName: 'chromium',
			},
			grep: /@:jupyter/
		},
		{
			name: 'release-screenshots',
			testDir: './test/e2e/release-screenshots',
			testMatch: '*.screenshot.ts',
			testIgnore: [],
			use: {
				artifactDir: 'release-screenshots',
			},
		},
	],
});

/**
 * Check if the current platform is openSUSE
 */
function isOpenSUSE(): boolean {
	try {
		const osRelease = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
		const id = osRelease.match(/^id=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
		const idLike = osRelease.match(/^id_like=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';

		return id.startsWith('opensuse') || id.includes('opensuse-leap') || idLike.includes('opensuse');
	} catch {
		return false;
	}
}

/**
 * Check if the current platform is SLES (SUSE Linux Enterprise Server)
 */
function isSLES(): boolean {
	try {
		const osRelease = fs.readFileSync('/etc/os-release', 'utf8').toLowerCase();
		const id = osRelease.match(/^id=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';
		const idLike = osRelease.match(/^id_like=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? '';

		return id === 'sles' || idLike.includes('sles');
	} catch {
		return false;
	}
}

// Set environment variable for tests to check
const IS_OPENSUSE = isOpenSUSE();
process.env.IS_OPENSUSE = IS_OPENSUSE ? 'true' : 'false';

const IS_SLES = isSLES();
process.env.IS_SLES = IS_SLES ? 'true' : 'false';
