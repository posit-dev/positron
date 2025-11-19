/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import path = require('path');
import archiver from 'archiver';
import * as playwright from '@playwright/test';
import { Application } from '../../infra';

export interface AttachScreenshotsToReportOptions {
	app: Application;
	testInfo: playwright.TestInfo;
}

export interface AttachLogsToReportOptions {
	suiteId: string;
	logsPath: string;
	testInfo: playwright.TestInfo;
}

export interface TracingOptions {
	app: Application;
	testInfo: playwright.TestInfo;
}

export function AttachScreenshotsToReportFixture() {
	return async (options: AttachScreenshotsToReportOptions, use: (arg0: void) => Promise<void>) => {
		const { app, testInfo } = options;
		let screenShotCounter = 1;
		const page = app.code.driver.page;
		const screenshots: string[] = [];

		app.code.driver.takeScreenshot = async function (name: string) {
			const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
			await page.screenshot({ path: screenshotPath });
			screenshots.push(screenshotPath);
		};

		await use();

		// if test failed, take and attach screenshot
		if (testInfo.status !== testInfo.expectedStatus) {
			const screenshot = await page.screenshot();
			await testInfo.attach('on-test-end', { body: screenshot, contentType: 'image/png' });
		}

		for (const screenshotPath of screenshots) {
			testInfo.attachments.push({ name: path.basename(screenshotPath), path: screenshotPath, contentType: 'image/png' });
		}
	};
}

export function AttachLogsToReportFixture() {
	return async (options: AttachLogsToReportOptions, use: (arg0: void) => Promise<void>) => {
		const { suiteId, logsPath, testInfo } = options;

		await use();

		if (!suiteId) { return; }

		// In CI, only attach logs for failed/retried tests to reduce blob report size
		// const isCI = process.env.CI === 'true';
		// const shouldAttachLogs = !isCI ||
		// 	testInfo.status !== testInfo.expectedStatus ||
		// 	testInfo.retry ||
		// 	process.env.ATTACH_ALL_LOGS === 'true';

		// if (!shouldAttachLogs) {
		// 	// Skip log attachment for passing tests in CI
		// 	return;
		// }

		const zipPath = path.join(logsPath, 'logs.zip');
		const output = fs.createWriteStream(zipPath);
		const archive = archiver('zip', { zlib: { level: 9 } });

		archive.on('error', (err) => {
			throw err;
		});

		archive.pipe(output);

		// add all log files to the archive, but exclude trace files (they're handled separately)
		archive.glob('**/*', { cwd: logsPath, ignore: ['logs.zip', 'trace-*.zip', '**/trace-*.zip'] });

		// wait for the archive to finalize and the output stream to close
		await new Promise((resolve, reject) => {
			output.on('close', () => resolve(undefined));
			output.on('error', reject);
			archive.finalize();
		});

		// attach the zipped file to the report
		await testInfo.attach(`logs-${path.basename(testInfo.file)}.zip`, {
			path: zipPath,
			contentType: 'application/zip',
		});

		// remove the logs.zip file
		try {
			await fs.promises.unlink(zipPath);
		} catch (err) {
			console.error(`Failed to remove ${zipPath}:`, err);
		}
	};
}

export function TracingFixture() {
	return async (options: TracingOptions, use: (arg0: Application) => Promise<void>) => {
		const { app, testInfo } = options;

		// Determine execution mode
		const isCommandLineRun = process.env.npm_execpath && !(process.env.PW_UI_MODE === 'true');
		// Use Playwright's built-in tracing only for browser-based runs (extension, UI mode).
		// Use custom tracing for Positron desktop runs or CLI runs.
		if (
			testInfo.project.use.browserName &&
			!isCommandLineRun
		) {
			// Browser-based tests use Playwright's built-in tracing (currently disabled with trace: 'off')
			await use(app);
		} else {
			// start tracing
			await app.startTracing(testInfo.titlePath.join(' › '));

			await use(app);

			// stop tracing
			const title = path.basename(`_trace`); // do NOT use title of 'trace' - conflicts with the default trace
			const tracePath = testInfo.outputPath(`${title}.zip`);
			await app.stopTracing(title, true, tracePath);

			// attach the trace to the report if CI and test failed or not in CI
			const isCI = process.env.CI === 'true';
			if (!isCI || testInfo.status !== testInfo.expectedStatus || testInfo.retry || process.env.PW_TRACE === 'on') {
				testInfo.attachments.push({ name: 'trace', path: tracePath, contentType: 'application/zip' });
			} else if (isCI) {
				// In CI, delete trace files for passing tests to save disk space in blob reports
				try {
					await fs.promises.unlink(tracePath);
				} catch (error) {
					// Ignore - trace file may not exist or may already be deleted
				}
			}
		}
	};
}
