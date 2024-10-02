/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as vscodetest from '@vscode/test-electron';
import fetch from 'node-fetch';
import { MultiLogger, ConsoleLogger, FileLogger, Logger, measureAndLog, getBuildElectronPath, getBuildVersion, getDevElectronPath } from '../../automation';
import { installAllHandlers, retry } from './utils';

let version: string | undefined;
export const ROOT_PATH = path.join(__dirname, '..', '..', '..');
const TEST_DATA_PATH = process.env.TEST_DATA_PATH || 'TEST_DATA_PATH not set';
const WORKSPACE_PATH = path.join(TEST_DATA_PATH, 'qa-example-content');
const EXTENSIONS_PATH = path.join(TEST_DATA_PATH, 'extensions-dir');
const LOGS_DIR = process.env.BUILD_ARTIFACTSTAGINGDIRECTORY || 'smoke-tests-default';

const asBoolean = (value: string | undefined): boolean | undefined => {
	return value === 'true' ? true : value === 'false' ? false : undefined;
};

const OPTS: ParseOptions = {
	tracing: asBoolean(process.env.TRACING),
	parallel: asBoolean(process.env.PARALLEL),
	web: asBoolean(process.env.WEB),
	build: process.env.BUILD,
	remote: asBoolean(process.env.REMOTE),
	verbose: asBoolean(process.env.VERBOSE),
	headless: asBoolean(process.env.HEADLESS),
	browser: process.env.BROWSER,
	electronArgs: process.env.ELECTRON_ARGS,
};

/**
 * Setup the environment, logs, hooks for the test suite and then START the application.
 *
 * @returns The logger instance for the test suite.
 */
export function setupAndStartApp(): Logger {
	// Dynamically determine the test file name
	const suiteName = getTestFileName();
	const logsRootPath = path.join(ROOT_PATH, '.build', 'logs', LOGS_DIR, suiteName);
	const crashesRootPath = path.join(ROOT_PATH, '.build', 'crashes', LOGS_DIR, suiteName);

	// Create a new logger for this suite
	const logger = createLogger(logsRootPath);

	// Set up environment, hooks, etc
	setupTestEnvironment(logger);
	setTestDefaults(logger, logsRootPath, crashesRootPath);
	installAllHandlers(logger);

	return logger;
}

/**
 * Dynamically determines the test file path based on the caller's stack trace.
 *
 * @returns The file name of the test file.
 */
function getTestFileName(): string {
	const originalFunc = Error.prepareStackTrace;

	try {
		// Capture the stack trace
		const err = new Error();
		Error.prepareStackTrace = (_, stack) => stack;

		// Stack index 2 points to the immediate caller of this function
		const stackFrames = err.stack as any;
		const callerFilePath = stackFrames[2].getFileName();  // Adjust index based on context

		return path.basename(callerFilePath);
	} catch (e) {
		console.error('Failed to retrieve caller file name:', e);
		return 'unknown';
	} finally {
		// Restore the original stack trace behavior
		Error.prepareStackTrace = originalFunc;
	}
}

function setupTestEnvironment(logger: Logger) {
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

		if (OPTS.remote) {
			logger.log(`Running desktop remote smoke tests against ${electronPath}`);
		} else {
			logger.log(`Running desktop smoke tests against ${electronPath}`);
		}
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
	}
}

function setTestDefaults(logger: Logger, logsRootPath: string, crashesRootPath: string) {
	before(async function () {
		this.timeout(5 * 60 * 1000); // increase timeout for downloading VSCode

		if (!OPTS.web && !OPTS.remote && OPTS.build) {
			// Only enabled when running with --build and not in web or remote
			await measureAndLog(() => ensureStableCode(TEST_DATA_PATH, logger, OPTS), 'ensureStableCode', logger);
		}

		this.defaultOptions = {
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
