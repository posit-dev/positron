/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as rimraf from 'rimraf';
import * as mkdirp from 'mkdirp';
import * as vscodetest from '@vscode/test-electron';
import { MultiLogger, ConsoleLogger, FileLogger, Logger, measureAndLog, getBuildElectronPath, getBuildVersion, getDevElectronPath, Quality } from '../../automation';
import fetch from 'node-fetch';
import { retry } from './utils';
import minimist = require('minimist');

export type ParseOptions = {
	verbose?: boolean;
	remote?: boolean;
	headless?: boolean;
	web?: boolean;
	tracing?: boolean;
	build?: string;
	'stable-build'?: string;
	browser?: string;
	electronArgs?: string;
};

let quality: Quality;
let version: string | undefined;
export const rootPath = path.join(__dirname, '..', '..', '..');
export const testDataPath = path.join(os.tmpdir(), 'vscsmoke');
const workspacePath = path.join(testDataPath, 'qa-example-content');
const extensionsPath = path.join(testDataPath, 'extensions-dir');
export const opts = parseOptions();

// mkdirp.sync(testDataPath);

export function parseOptions(): ParseOptions {

	// Parsing command-line arguments
	const [, , ...args] = process.argv;
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
			'tracing'
		],
		default: {
			verbose: false
		}
	}) as {
		verbose?: boolean;
		remote?: boolean;
		headless?: boolean;
		web?: boolean;
		tracing?: boolean;
		build?: string;
		'stable-build'?: string;
		browser?: string;
		electronArgs?: string;
	};
}


export function createLogger(logsRootPath: string): Logger {
	const loggers: Logger[] = [];

	if (opts.verbose) {
		loggers.push(new ConsoleLogger());
	}

	fs.rmSync(logsRootPath, { recursive: true, force: true, maxRetries: 3 });
	mkdirp.sync(logsRootPath);

	loggers.push(new FileLogger(path.join(logsRootPath, `smoke-test-runner.log`)));

	return new MultiLogger(loggers);
}

export function parseVersion(version: string): { major: number; minor: number; patch: number } {
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

export async function setupRepository(workspacePath: string, opts: any): Promise<void> {
	const testRepoUrl = 'https://github.com/posit-dev/qa-example-content.git';

	if (opts['test-repo']) {
		console.log('Copying test project repository:', opts['test-repo']);
		rimraf.sync(workspacePath);

		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${opts['test-repo']}" "${workspacePath}"\\*`);
		} else {
			cp.execSync(`cp -R "${opts['test-repo']}" "${workspacePath}"`);
		}
	} else {
		if (!fs.existsSync(workspacePath)) {
			console.log('Cloning test project repository...');
			const res = cp.spawnSync('git', ['clone', testRepoUrl, workspacePath], { stdio: 'inherit' });
			if (!fs.existsSync(workspacePath)) {
				throw new Error(`Clone operation failed: ${res.stderr.toString()}`);
			}
		} else {
			console.log('Cleaning test project repository...');
			cp.spawnSync('git', ['fetch'], { cwd: workspacePath, stdio: 'inherit' });
			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: workspacePath, stdio: 'inherit' });
			cp.spawnSync('git', ['clean', '-xdf'], { cwd: workspacePath, stdio: 'inherit' });
		}
	}
}

export async function ensureStableCode(testDataPath: string, logger: Logger, opts: any): Promise<void> {
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

export function setup(suiteName: string): Logger {
	const logsRootPath = path.join(rootPath, '.build', 'logs', 'smoke-tests-electron', suiteName);
	const logger = createLogger(logsRootPath);

	setupSmokeTestEnvironment(logger);
	setupBeforeHook(logger, suiteName);

	return logger;
}

export function setupSmokeTestEnvironment(logger: Logger) {
	//
	// #### Electron Smoke Tests ####
	//

	if (!opts.web) {
		let testCodePath = opts.build;
		let electronPath: string;

		if (testCodePath) {
			electronPath = getBuildElectronPath(testCodePath);
			version = getBuildVersion(testCodePath);
		} else {
			testCodePath = getDevElectronPath();
			electronPath = testCodePath;
			process.env.VSCODE_REPOSITORY = rootPath;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';
		}

		if (!fs.existsSync(electronPath || '')) {
			throw new Error(`Cannot find VSCode at ${electronPath}. Please run VSCode once first (scripts/code.sh, scripts\\code.bat) and try again.`);
		}

		quality = parseQuality();

		if (opts.remote) {
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
		const testCodeServerPath = opts.build || process.env.VSCODE_REMOTE_SERVER_PATH;

		if (typeof testCodeServerPath === 'string') {
			if (!fs.existsSync(testCodeServerPath)) {
				throw new Error(`Cannot find Code server at ${testCodeServerPath}.`);
			} else {
				logger.log(`Running web smoke tests against ${testCodeServerPath}`);
			}
		}

		if (!testCodeServerPath) {
			process.env.VSCODE_REPOSITORY = rootPath;
			process.env.VSCODE_DEV = '1';
			process.env.VSCODE_CLI = '1';

			logger.log(`Running web smoke out of sources`);
		}

		quality = parseQuality();
		logger.log(`VS Code product quality: ${quality}.`);
	}
}

export async function setupBeforeHook(logger: Logger, suiteName: string): Promise<void> {
	// to do: create logger here and return it

	before(async function () {
		this.timeout(5 * 60 * 1000); // increase timeout for downloading VSCode

		if (!opts.web && !opts.remote && opts.build) {
			// Only enabled when running with --build and not in web or remote
			await measureAndLog(() => ensureStableCode(testDataPath, logger, opts), 'ensureStableCode', logger);
		}

		// Set default options
		const logsRootPath = path.join(rootPath, '.build', 'logs', 'smoke-tests-electron', suiteName);
		const crashesRootPath = path.join(rootPath, '.build', 'crashes', 'smoke-tests-electron', suiteName);
		this.defaultOptions = {
			quality,
			codePath: opts.build,
			workspacePath,
			userDataDir: path.join(testDataPath, 'd'),
			extensionsPath,
			logger,
			logsPath: path.join(logsRootPath, 'suite_unknown'),
			crashesPath: path.join(crashesRootPath, 'suite_unknown'),
			verbose: opts.verbose,
			remote: opts.remote,
			web: opts.web,
			tracing: opts.tracing,
			headless: opts.headless,
			browser: opts.browser,
			extraArgs: (opts.electronArgs || '').split(' ').map(arg => arg.trim()).filter(arg => !!arg),
		};
	});
}
