/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as vscodetest from '@vscode/test-electron';
import fetch from 'node-fetch';
import minimist = require('minimist');
import { MultiLogger, ConsoleLogger, FileLogger, Logger, measureAndLog, getBuildElectronPath, getBuildVersion, getDevElectronPath, Quality } from '../../automation';
import { retry } from '../src/utils';

let quality: Quality;
let version: string | undefined;

export const ROOT_PATH = path.join(__dirname, '..', '..', '..', '..');
const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const WORKSPACE_PATH = path.join(TEST_DATA_PATH, 'qa-example-content');
const EXTENSIONS_PATH = path.join(TEST_DATA_PATH, 'extensions-dir');
const OPTS = parseOptions();

/**
 * Setup the environment and hooks for the test
 *
 * @param suiteName name of the test
 * @returns
 */
export function setupEnvAndHooks(suiteName: string): Logger {
	const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', 'smoke-tests-electron', suiteName);
	const logger = createLogger(logsRootPath);

	setupSmokeTestEnvironment(logger);
	setupBeforeHooks(logger, suiteName);

	return logger;
}

function setupSmokeTestEnvironment(logger: Logger) {
	//
	// #### Electron Smoke Tests ####
	//

	if (!OPTS.web) {
		let testCodePath = OPTS.build;
		let electronPath: string;

		if (testCodePath) {
			electronPath = getBuildElectronPath(testCodePath);
			version = getBuildVersion(testCodePath);
		} else {
			testCodePath = getDevElectronPath();
			electronPath = testCodePath;
			process.env.VSCODE_REPOSITORY = ROOT_PATH;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';
		}

		if (!fs.existsSync(electronPath || '')) {
			throw new Error(`Cannot find VSCode at ${electronPath}. Please run VSCode once first (scripts/code.sh, scripts\\code.bat) and try again.`);
		}

		quality = parseQuality();

		if (OPTS.remote) {
			logger.log(`Running desktop remote smoke tests against ${electronPath}`);
		} else {
			logger.log(`Running desktop smoke tests against ${electronPath}`);
		}

		logger.log(`VS Code product quality: ${quality}.`);
	}

	//
	// #### Web Smoke Tests ####
	//
	else {
		const testCodeServerPath = OPTS.build || process.env.VSCODE_REMOTE_SERVER_PATH;

		if (typeof testCodeServerPath === 'string') {
			if (!fs.existsSync(testCodeServerPath)) {
				throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
			} else {
				logger.log(`Running web smoke tests against ${testCodeServerPath}`);
			}
		}

		if (!testCodeServerPath) {
			process.env.VSCODE_REPOSITORY = ROOT_PATH;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';

			logger.log(`Running web smoke out of sources`);
		}

		quality = parseQuality();
		logger.log(`VS Code product quality: ${quality}.`);
	}
}

function setupBeforeHooks(logger: Logger, suiteName: string) {
	before(async function () {
		// startTime = Date.now();
		this.timeout(5 * 60 * 1000); // increase timeout for downloading VSCode

		if (!OPTS.web && !OPTS.remote && OPTS.build) {
			// Only enabled when running with --build and not in web or remote
			await measureAndLog(() => ensureStableCode(TEST_DATA_PATH, logger, OPTS), 'ensureStableCode', logger);
		}

		// Set default options
		const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', 'smoke-tests-electron', suiteName);
		const crashesRootPath = path.join(ROOT_PATH, '.build', 'crashes', 'smoke-tests-electron', suiteName);
		this.defaultOptions = {
			quality,
			codePath: OPTS.build,
			workspacePath: WORKSPACE_PATH,
			userDataDir: path.join(TEST_DATA_PATH, 'd'),
			extensionsPath: EXTENSIONS_PATH,
			logger,
			logsPath: path.join(logsRootPath, 'suite_unknown'),
			crashesPath: path.join(crashesRootPath, 'suite_unknown'),
			verbose: OPTS.verbose,
			remote: OPTS.remote,
			web: OPTS.web,
			tracing: OPTS.tracing,
			headless: OPTS.headless,
			browser: OPTS.browser,
			extraArgs: (OPTS.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};
	});
}

function parseOptions(): ParseOptions {
	const args = process.argv.slice(2);

	// Map environment variables to command-line arguments
	const envToArgsMap: Record<string, string[]> = {
		BUILD: ['--build'],
		HEADLESS: ['--headless'],
		PARALLEL: ['--parallel'],
		REMOTE: ['--remote'],
		TRACING: ['--tracing'],
		VERBOSE: ['--verbose'],
		WEB: ['--web']
	};

	// Add the mapped arguments based on environment variables
	for (const [envVar, argList] of Object.entries(envToArgsMap)) {
		const envValue = process.env[envVar];
		if (envValue) {
			args.push(...argList, ...(envValue !== 'true' && envValue !== 'false' ? [envValue] : []));
		}
	}

	// Parse the final args array using minimist
	return minimist(args, {
		string: [
			'browser',
			'build',
			'stable-build',
			'wait-time',
			'test-repo',
			'electronArgs'
		],
		boolean: [
			'verbose',
			'remote',
			'web',
			'headless',
			'tracing',
			'parallel',
		],
		default: {
			verbose: false
		}
	}) as ParseOptions;
}

function createLogger(logsRootPath: string): Logger {
	const loggers: Logger[] = [];

	if (OPTS.verbose) {
		loggers.push(new ConsoleLogger());
	}

	fs.rmSync(logsRootPath, { recursive: true, force: true, maxRetries: 3 });
	mkdirp.sync(logsRootPath);

	loggers.push(new FileLogger(path.join(logsRootPath, `smoke-test-runner.log`)));

	return new MultiLogger(loggers);
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
	const [, major, minor, patch] = /^(\d+)\.(\d+)\.(\d+)/.exec(version)!;
	return { major: parseInt(major), minor: parseInt(minor), patch: parseInt(patch) };
}

function parseQuality(): Quality {
	if (process.env.VSCODE_DEV === '1') {
		return Quality.Dev;
	}

	const quality = process.env.VSCODE_QUALITY ?? '';

	switch (quality) {
		case 'stable':
			return Quality.Stable;
		case 'insider':
			return Quality.Insiders;
		case 'exploration':
			return Quality.Exploration;
		case 'oss':
			return Quality.OSS;
		default:
			return Quality.Dev;
	}
}

async function ensureStableCode(testDataPath: string, logger: Logger, opts: any): Promise<void> {
	let stableCodePath = opts['stable-build'];

	if (!stableCodePath) {
		const current = parseVersion(version!);
		const versionsReq = await retry(() => measureAndLog(() => fetch('https://update.code.visualstudio.com/api/releases/stable'), 'versionReq', logger), 1000, 20);

		if (!versionsReq.ok) {
			throw new Error('Could not fetch releases from update server');
		}

		const versions: string[] = await measureAndLog(() => versionsReq.json(), 'versionReq.json()', logger);
		const stableVersion = versions.find(raw => {
			const version = parseVersion(raw);
			return version.major < current.major || (version.major === current.major && version.minor < current.minor);
		});

		if (!stableVersion) {
			throw new Error(`Could not find suitable stable version for ${version}`);
		}

		logger.log(`Found VS Code v${version}, downloading previous VS Code version ${stableVersion}...`);

		const stableCodeDestination = path.join(testDataPath, 's');
		const stableCodeExecutable = await retry(() => measureAndLog(() => vscodetest.download({
			cachePath: stableCodeDestination,
			version: stableVersion,
			extractSync: true,
		}), 'download stable code', logger), 1000, 3);

		stableCodePath = path.dirname(stableCodeExecutable);
	}

	if (!fs.existsSync(stableCodePath)) {
		throw new Error(`Cannot find Stable VSCode at ${stableCodePath}.`);
	}

	logger.log(`Using stable build ${stableCodePath} for migration tests`);

	opts['stable-build'] = stableCodePath;
}

type ParseOptions = {
	verbose?: boolean;
	remote?: boolean;
	headless?: boolean;
	web?: boolean;
	tracing?: boolean;
	parallel?: boolean;
	build?: string;
	'stable-build'?: string;
	browser?: string;
	electronArgs?: string;
};
