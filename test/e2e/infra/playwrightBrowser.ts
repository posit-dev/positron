/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { ChildProcess, spawn } from 'child_process';
import { join } from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import { Logger, measureAndLog } from './logger';
import type { LaunchOptions } from './code';
import { PlaywrightDriver } from './playwrightDriver';

const root = join(__dirname, '..', '..', '..');

let port = 9000;

export async function launch(options: LaunchOptions): Promise<{ serverProcess: ChildProcess; driver: PlaywrightDriver }> {

	// Launch server
	const { serverProcess, endpoint } = await launchServer(options);

	// Launch browser
	const { browser, context, page, pageLoadedPromise } = await launchBrowser(options, endpoint);

	return {
		serverProcess,
		driver: new PlaywrightDriver(browser, context, page, serverProcess, pageLoadedPromise, options)
	};
}

// Modified `launchServer` function to add support for multiple ports to enable parallel test
// execution of browser tests. Also added helper functions: `getServerArgs`, `resolveServerLocation`,
// and `startServer` to make this code easier to read.
async function launchServer(options: LaunchOptions) {
	const { userDataDir, codePath, extensionsPath, logger, logsPath } = options;
	const serverLogsPath = join(logsPath, 'server');
	const codeServerPath = codePath ?? process.env.VSCODE_REMOTE_SERVER_PATH;
	const agentFolder = userDataDir;
	await measureAndLog(() => fs.promises.mkdir(agentFolder, { recursive: true }), `mkdirp(${agentFolder})`, logger);

	const env = {
		VSCODE_REMOTE_SERVER_PATH: codeServerPath,
		...process.env,
	};

	const maxRetries = 10;
	let serverProcess: ChildProcess | null = null;
	let endpoint: string | undefined;

	for (let attempts = 0; attempts < maxRetries; attempts++) {
		const currentPort = port++;
		const args = getServerArgs(currentPort, extensionsPath, agentFolder, serverLogsPath, options.verbose);
		const serverLocation = resolveServerLocation(codeServerPath, logger);

		logger.log(`Attempting to start server on port ${currentPort}`);
		logger.log(`Command: '${serverLocation}' ${args.join(' ')}`);

		try {
			serverProcess = await startServer(serverLocation, args, env, logger);
			endpoint = await measureAndLog(
				() => waitForEndpoint(serverProcess!, logger),
				'waitForEndpoint(serverProcess)',
				logger
			);

			logger.log(`Server started successfully on port ${currentPort}`);
			break; // Exit loop on success
		} catch (error) {
			if ((error as Error).message.includes('EADDRINUSE')) {
				logger.log(`Port ${currentPort} is already in use. Retrying...`);
				serverProcess?.kill();
			} else {
				throw error; // Rethrow non-port-related errors
			}
		}
	}

	if (!serverProcess || !endpoint) {
		throw new Error('Failed to launch the server after multiple attempts.');
	}

	return { serverProcess, endpoint };
}

function getServerArgs(
	port: number,
	extensionsPath: string,
	agentFolder: string,
	logsPath: string,
	verbose?: boolean
): string[] {
	const args = [
		'--disable-telemetry',
		'--disable-workspace-trust',
		`--port=${port}`,
		'--enable-smoke-test-driver',
		`--extensions-dir=${extensionsPath}`,
		`--server-data-dir=${agentFolder}`,
		'--accept-server-license-terms',
		`--logsPath=${logsPath}`,
		'--connection-token',
		'dev-token',
	];

	if (verbose) {
		args.push('--log=trace');
	}

	return args;
}

function resolveServerLocation(codeServerPath: string | undefined, logger: Logger): string {
	if (codeServerPath) {
		const { serverApplicationName } = require(join(codeServerPath, 'product.json'));
		const serverLocation = join(codeServerPath, 'bin', `${serverApplicationName}${process.platform === 'win32' ? '.cmd' : ''}`);
		logger.log(`Using built server from '${serverLocation}'`);
		return serverLocation;
	}

	const scriptPath = join(root, `scripts/code-server.${process.platform === 'win32' ? 'bat' : 'sh'}`);
	logger.log(`Using source server from '${scriptPath}'`);
	return scriptPath;
}

async function startServer(
	serverLocation: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	logger: Logger
): Promise<ChildProcess> {
	logger.log(`Starting server: ${serverLocation}`);
	const serverProcess = spawn(serverLocation, args, { env, shell: process.platform === 'win32' });
	logger.log(`Server started (pid: ${serverProcess.pid})`);
	return serverProcess;
}

async function launchBrowser(options: LaunchOptions, endpoint: string) {
	const { logger, workspacePath, tracing, snapshots, headless } = options;

	const browser = await measureAndLog(() => playwright[options.browser ?? 'chromium'].launch({
		headless: headless ?? false,
		timeout: 0
	}), 'playwright#launch', logger);

	browser.on('disconnected', () => logger.log(`Playwright: browser disconnected`));

	const context = await measureAndLog(() => browser.newContext(), 'browser.newContext', logger);

	if (tracing) {
		try {
			await measureAndLog(() => context.tracing.start({ screenshots: true, snapshots }), 'context.tracing.start()', logger);
			// --- Start Positron ---
			// Yes, this is hacky, but we are unable to disable default tracing in Playwright browser tests
			// See related discussion: https://github.com/microsoft/playwright/issues/33303#issuecomment-2442096479
			context.tracing.start = async (...args) => {
				logger.log('Tracing is already managed, skipping default tracing start.');
			};
			// --- End Positron ---
		} catch (error) {
			logger.log(`Playwright (Browser): Failed to start playwright tracing (${error})`); // do not fail the build when this fails
		}
	}

	const page = await measureAndLog(() => context.newPage(), 'context.newPage()', logger);
	await measureAndLog(() => page.setViewportSize({ width: 1200, height: 800 }), 'page.setViewportSize', logger);

	if (options.verbose) {
		context.on('page', () => logger.log(`Playwright (Browser): context.on('page')`));
		context.on('requestfailed', e => logger.log(`Playwright (Browser): context.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));

		page.on('console', e => logger.log(`Playwright (Browser): window.on('console') [${e.text()}]`));
		page.on('dialog', () => logger.log(`Playwright (Browser): page.on('dialog')`));
		page.on('domcontentloaded', () => logger.log(`Playwright (Browser): page.on('domcontentloaded')`));
		page.on('load', () => logger.log(`Playwright (Browser): page.on('load')`));
		page.on('popup', () => logger.log(`Playwright (Browser): page.on('popup')`));
		page.on('framenavigated', () => logger.log(`Playwright (Browser): page.on('framenavigated')`));
		page.on('requestfailed', e => logger.log(`Playwright (Browser): page.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
	}

	page.on('pageerror', async (error) => logger.log(`Playwright (Browser) ERROR: page error: ${error}`));
	page.on('crash', () => logger.log('Playwright (Browser) ERROR: page crash'));
	page.on('close', () => logger.log('Playwright (Browser): page close'));
	page.on('response', async (response) => {
		if (response.status() >= 400) {
			logger.log(`Playwright (Browser) ERROR: HTTP status ${response.status()} for ${response.url()}`);
		}
	});

	const payloadParam = `[${[
		'["enableProposedApi",""]',
		'["skipWelcome", "true"]',
		'["skipReleaseNotes", "true"]',
		`["logLevel","${options.verbose ? 'trace' : 'info'}"]`
	].join(',')}]`;

	const gotoPromise = measureAndLog(() => page.goto(`${endpoint}&${workspacePath.endsWith('.code-workspace') ? 'workspace' : 'folder'}=${URI.file(workspacePath!).path}&payload=${payloadParam}`), 'page.goto()', logger);
	const pageLoadedPromise = page.waitForLoadState('load');

	await gotoPromise;

	return { browser, context, page, pageLoadedPromise };
}

function waitForEndpoint(server: ChildProcess, logger: Logger): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let endpointFound = false;

		server.stdout?.on('data', data => {
			if (!endpointFound) {
				logger.log(`[server] stdout: ${data}`); // log until endpoint found to diagnose issues
			}

			const matches = data.toString('ascii').match(/Web UI available at (.+)/);
			if (matches !== null) {
				endpointFound = true;

				resolve(matches[1]);
			}
		});

		server.stderr?.on('data', error => {
			if (!endpointFound) {
				logger.log(`[server] stderr: ${error}`); // log until endpoint found to diagnose issues
			}

			if (error.toString().indexOf('EADDRINUSE') !== -1) {
				reject(new Error(error));
			}
		});
	});
}
