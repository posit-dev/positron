/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from '@playwright/test';
import { URI } from 'vscode-uri';
import { measureAndLog } from './logger';
import type { LaunchOptions } from './code';
import { PlaywrightDriver } from './playwrightDriver';

/**
 * Launches a browser against an external server (e.g., one started via ./scripts/code-server.sh)
 */
export async function launch(options: LaunchOptions, serverUrl: string): Promise<{ driver: PlaywrightDriver }> {
	// Launch browser
	const { browser, context, page, pageLoadedPromise } = await launchBrowser(options, serverUrl);

	return {
		driver: new PlaywrightDriver(browser, context, page, undefined, pageLoadedPromise, options)
	};
}

async function launchBrowser(options: LaunchOptions, serverUrl: string) {
	const { logger, workspacePath, tracing, snapshots, headless } = options;

	const [browserType, browserChannel] = (options.browser ?? 'chromium').split('-');
	const browser = await measureAndLog(() => playwright[browserType as unknown as 'chromium' | 'webkit' | 'firefox'].launch({
		headless: headless ?? false,
		timeout: 0,
		channel: browserChannel,
	}), 'playwright#launch', logger);

	browser.on('disconnected', () => logger.log(`Playwright: browser disconnected`));

	const context = await measureAndLog(() => browser.newContext(), 'browser.newContext', logger);

	if (tracing) {
		try {
			await measureAndLog(() => context.tracing.start({ screenshots: true, snapshots }), 'context.tracing.start()', logger);
			// Prevent duplicate tracing start calls
			context.tracing.start = async (...args) => {
				logger.log('Tracing is already managed, skipping default tracing start.');
			};
		} catch (error) {
			logger.log(`Playwright (External Server): Failed to start playwright tracing (${error})`);
		}
	}

	const page = await measureAndLog(() => context.newPage(), 'context.newPage()', logger);
	await measureAndLog(() => page.setViewportSize({ width: 1200, height: 800 }), 'page.setViewportSize', logger);

	if (options.verbose) {
		context.on('page', () => logger.log(`Playwright (External Server): context.on('page')`));
		context.on('requestfailed', e => logger.log(`Playwright (External Server): context.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));

		page.on('console', e => logger.log(`Playwright (External Server): window.on('console') [${e.text()}]`));
		page.on('dialog', () => logger.log(`Playwright (External Server): page.on('dialog')`));
		page.on('domcontentloaded', () => logger.log(`Playwright (External Server): page.on('domcontentloaded')`));
		page.on('load', () => logger.log(`Playwright (External Server): page.on('load')`));
		page.on('popup', () => logger.log(`Playwright (External Server): page.on('popup')`));
		page.on('framenavigated', () => logger.log(`Playwright (External Server): page.on('framenavigated')`));
		page.on('requestfailed', e => logger.log(`Playwright (External Server): page.on('requestfailed') [${e.failure()?.errorText} for ${e.url()}]`));
	}

	page.on('pageerror', async (error) => logger.log(`Playwright (External Server) ERROR: page error: ${error}`));
	page.on('crash', () => logger.log('Playwright (External Server) ERROR: page crash'));
	page.on('close', () => logger.log('Playwright (External Server): page close'));
	page.on('response', async (response) => {
		if (response.status() >= 400) {
			logger.log(`Playwright (External Server) ERROR: HTTP status ${response.status()} for ${response.url()}`);
		}
	});

	const payloadParam = `[${[
		'["enableProposedApi",""]',
		'["skipWelcome", "true"]',
		'["skipReleaseNotes", "true"]',
		`["logLevel","${options.verbose ? 'trace' : 'info'}"]`
	].join(',')}]`;

	// Construct URL for external server
	let fullUrl: string;

	if (serverUrl.includes(':8787')) {
		// Port 8787 is used for RStudio Server or other R-based interfaces
		// These don't use VS Code-specific parameters, so just connect to the base URL
		fullUrl = serverUrl;
	} else {
		// Default VS Code server behavior (e.g., port 8080)
		const workspaceParam = workspacePath.endsWith('.code-workspace') ? 'workspace' : 'folder';
		const separator = serverUrl.includes('?') ? '&' : '?';
		fullUrl = `${serverUrl}${separator}${workspaceParam}=${URI.file(workspacePath!).path}&payload=${payloadParam}`;
	}

	logger.log(`Connecting to external server: ${fullUrl}`);

	const gotoPromise = measureAndLog(() => page.goto(fullUrl), 'page.goto() [external server]', logger);
	const pageLoadedPromise = page.waitForLoadState('load');

	await gotoPromise;

	return { browser, context, page, pageLoadedPromise };
}
