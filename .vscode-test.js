/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { defineConfig } = require('@vscode/test-cli');

/**
 * A list of extension folders who have opted into tests, or configuration objects.
 * Edit me to add more!
 *
 * @type {Array<Partial<import("@vscode/test-cli").TestConfiguration> & { label: string }>}
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
		label: 'terminal-suggest',
		workspaceFolder: path.join(os.tmpdir(), `terminal-suggest-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'vscode-colorize-perf-tests',
		workspaceFolder: `extensions/vscode-colorize-perf-tests/test`,
		mocha: { timeout: 6000_000 }
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
		label: 'authentication',
		workspaceFolder: path.join(os.tmpdir(), `authentication-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'next-edit-suggestions',
		workspaceFolder: path.join(os.tmpdir(), `next-edit-suggestions-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
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
		label: 'positron-environment-modules',
		workspaceFolder: path.join(os.tmpdir(), `positron-environment-modules-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-catalog-explorer',
		workspaceFolder: path.join(os.tmpdir(), `positron-catalog-explorer-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-connections',
		workspaceFolder: path.join(os.tmpdir(), `positron-connections-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-duckdb',
		workspaceFolder: path.join(os.tmpdir(), `positron-duckdb-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-databricks',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-databricks-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-duckdb',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-duckdb-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-pins',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-pins-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-postgresql',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-postgresql-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-redshift',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-redshift-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-snowflake',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-snowflake-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-data-driver-sqlite',
		workspaceFolder: path.join(os.tmpdir(), `positron-data-driver-sqlite-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-notebook-export',
		workspaceFolder: 'extensions/positron-notebook-export/test-workspace',
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-run-app',
		workspaceFolder: 'extensions/positron-run-app/test-workspace',
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-supervisor',
		workspaceFolder: path.join(os.tmpdir(), `positron-supervisor-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-zed',
		workspaceFolder: path.join(os.tmpdir(), `positron-zed-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	{
		label: 'positron-pdf-server',
		workspaceFolder: path.join(os.tmpdir(), `positron-pdf-server-${Math.floor(Math.random() * 100000)}`),
		mocha: { timeout: 60_000 }
	},
	// --- End Positron ---
	{
		label: 'microsoft-authentication',
		mocha: { timeout: 60_000 }
	},
	{
		label: 'vscode-api-tests-folder',
		extensionDevelopmentPath: `extensions/vscode-api-tests`,
		workspaceFolder: `extensions/vscode-api-tests/testWorkspace`,
		mocha: { timeout: 60_000 },
		files: 'extensions/vscode-api-tests/out/singlefolder-tests/**/*.test.js',
	},
	{
		label: 'vscode-api-tests-workspace',
		extensionDevelopmentPath: `extensions/vscode-api-tests`,
		workspaceFolder: `extensions/vscode-api-tests/testworkspace.code-workspace`,
		mocha: { timeout: 60_000 },
		files: 'extensions/vscode-api-tests/out/workspace-tests/**/*.test.js',
	},
	{
		label: 'git-base',
		mocha: { timeout: 60_000 }
	},
	{
		label: 'copilot',
		files: 'extensions/copilot/dist/test-extension.js',
		mocha: { ui: 'tdd', timeout: 60_000 }
	}
];


const defaultLaunchArgs = process.env.API_TESTS_EXTRA_ARGS?.split(' ') || [
	'--disable-telemetry', '--disable-experiments', '--skip-welcome', '--skip-release-notes', `--crash-reporter-directory=${__dirname}/.build/crashes`, `--logsPath=${__dirname}/.build/logs/integration-tests`, '--no-cached-data', '--disable-updates', '--use-inmemory-secretstorage', '--disable-extensions', '--disable-workspace-trust'
];

// --- Start Positron ---
// Headless Electron on the CI image intermittently GP-faults during startup,
// inside libexpat while fontconfig initializes fonts on a worker thread (stack:
// libexpat <- libfontconfig <- libpangoft2). It happens before any test runs and
// takes the whole suite down. `scripts/test-remote-integration.sh` forces
// software GL for the launches it drives directly and does not hit this; the
// suites launched through vscode-test never saw those flags, because
// `API_TESTS_EXTRA_ARGS` is not exported by the shell drivers, so they fall back
// to the list above. Add the flags here so every desktop extension suite starts
// up the same way the Remote ones (and the e2e harness) do.
//
// Linux-only: the race is in the Linux system font stack, and forcing software
// GL for a headless test run is harmless there.
//
// `unshift`, not `push`: vscode-test appends `workspaceFolder` as a positional
// argument after these, and VS Code's CLI parser treats an unrecognized
// `--flag` as taking the next positional as its value. A Chromium switch left
// last therefore swallows the workspace path, and the suite launches with no
// folder open (`workspace.workspaceFolders` undefined). Keep a flag VS Code
// knows -- `--disable-workspace-trust` above -- at the end of this list.
if (process.platform === 'linux') {
	defaultLaunchArgs.unshift('--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing');
}
// --- End Positron ---

const config = defineConfig(extensions.map(extension => {
	/** @type {import('@vscode/test-cli').TestConfiguration} */
	const config = {
		platform: 'desktop',
		files: `extensions/${extension.label}/out/**/*.test.js`,
		extensionDevelopmentPath: `extensions/${extension.label}`,
		...extension,
	};

	config.mocha ??= {};
	if (process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || process.env.GITHUB_WORKSPACE) {
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
				mochaFile: path.join(
					process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || process.env.GITHUB_WORKSPACE || __dirname,
					`test-results/${process.platform}-${process.arch}-${suite.toLowerCase().replace(/[^\w]/g, '-')}-results.xml`
				)
			}
		};
	}

	if (!config.platform || config.platform === 'desktop') {
		config.launchArgs = defaultLaunchArgs;

		// --- Start Positron ---
		// Completions in `settings.json` pull in the JSON schema the Copilot
		// extension contributes at `ccsettings://root/schema.json` (see
		// `jsonValidation` in extensions/copilot/package.json, `fileMatch:
		// settings.json`). Fetching it activates that extension via
		// `onFileSystem:ccsettings`, and in the CI container that activation does not
		// complete, so every settings.json completion request hangs until mocha's 60s
		// timeout -- six deterministic failures per run. Only `settings.json` matches
		// that `fileMatch`, which is why the suite's other files are unaffected.
		// Disable the extension here so the suite tests its own providers.
		//
		// `--disable-extensions` in the list above cannot do this: it exempts
		// built-ins (`_isDisabledInEnv` in extensionEnablementService.ts) and every
		// extension is a built-in when running from source, and its presence also
		// short-circuits the per-extension list (`disableExtensions` in
		// environmentService.ts). Hence the filter. The `=` form keeps the trailing
		// token a value rather than a dangling flag, which would otherwise swallow
		// the `workspaceFolder` positional vscode-test appends after these.
		if (extension.label === 'configuration-editing') {
			config.launchArgs = [
				...defaultLaunchArgs.filter(a => a !== '--disable-extensions'),
				'--disable-extension=GitHub.copilot-chat',
			];
		}
		// --- End Positron ---
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

export default config;
