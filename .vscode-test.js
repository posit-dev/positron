/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

const path = require('path');
const { defineConfig } = require('@vscode/test-cli');
const os = require('os');

/**
 * A list of extension folders who have opted into tests, or configuration objects.
 * Edit me to add more!
 *
 * @type {Array<string | (Partial<import("@vscode/test-cli").TestConfiguration> & { label: string })>}
 */
const extensions = [
	{
		label: 'markdown-language-features',
		workspaceFolder: `extensions/markdown-language-features/test-workspace`,
		mocha: { timeout: 60_000 }
	},
	{
		label: 'ipynb',
		workspaceFolder: path.join(os.tmpdir(), `ipynb-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'notebook-renderers',
		workspaceFolder: path.join(os.tmpdir(), `nbout-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'vscode-colorize-tests',
		workspaceFolder: `extensions/vscode-colorize-tests/test`,
		mocha: { timeout: 60_000 }
	},
	{
		label: 'configuration-editing',
		workspaceFolder: path.join(os.tmpdir(), `confeditout-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'github-authentication',
		workspaceFolder: path.join(os.tmpdir(), `msft-auth-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	// --- Start Positron ---
	{
		label: 'positron-code-cells',
		workspaceFolder: path.join(os.tmpdir(), `positron-code-cells-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-r',
		workspaceFolder: path.join(os.tmpdir(), `positron-r-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-connections',
		workspaceFolder: path.join(os.tmpdir(), `positron-connections-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	}
	// --- End Positron ---
];


const defaultLaunchArgs = process.env.API_TESTS_EXTRA_ARGS?.split(' ') || [
	'--disable-telemetry', '--skip-welcome', '--skip-release-notes', `--crash-reporter-directory=${__dirname}/.build/crashes`, `--logsPath=${__dirname}/.build/logs/integration-tests`, '--no-cached-data', '--disable-updates', '--use-inmemory-secretstorage', '--disable-extensions', '--disable-workspace-trust'
];

module.exports = defineConfig(extensions.map(extension => {
	/** @type {import('@vscode/test-cli').TestConfiguration} */
	const config = typeof extension === 'object'
		? { files: `extensions/${extension.label}/out/**/*.test.js`, ...extension }
		: { files: `extensions/${extension}/out/**/*.test.js`, label: extension };

	config.mocha ??= {};
	if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY) {
		let suite = '';
		if (process.env.VSCODE_BROWSER) {
			suite = `${process.env.VSCODE_BROWSER} Browser Integration ${config.label} tests`;
		} else if (process.env.REMOTE_VSCODE) {
			suite = `Remote Integration ${config.label} tests`;
		} else {
			suite = `Integration ${config.label} tests`;
		}

		config.mocha.reporter = 'mocha-multi-reporters';
		config.mocha.reporterOptions = {
			reporterEnabled: 'spec, mocha-junit-reporter',
			mochaJunitReporterReporterOptions: {
				testsuitesTitle: `${suite} ${process.platform}`,
				mochaFile: path.join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY, `test-results/${process.platform}-${process.arch}-${suite.toLowerCase().replace(/[^\w]/g, '-')}-results.xml`)
			}
		};
	}

	if (!config.platform || config.platform === 'desktop') {
		config.launchArgs = defaultLaunchArgs;
		config.useInstallation = {
			fromPath: process.env.INTEGRATION_TEST_ELECTRON_PATH || `${__dirname}/scripts/code.${process.platform === 'win32' ? 'bat' : 'sh'}`,
		};
		config.env = {
			...config.env,
			VSCODE_SKIP_PRELAUNCH: '1',
		};
	} else {
		// web configs not supported, yet
	}

	return config;
}));
