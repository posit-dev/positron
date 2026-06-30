/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
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
		const page = app.code.driver.currentPage;
		const screenshots: string[] = [];

		app.code.driver.takeScreenshot = async function (name: string) {
			const screenshotPath = testInfo.outputPath(`${screenShotCounter++}-${name}.png`);
			await page.screenshot({ path: screenshotPath });
			screenshots.push(screenshotPath);
		};

		await use();

		// if test failed, take and attach screenshot
		if (testInfo.status !== testInfo.expectedStatus) {
			try {
				const screenshot = await page.screenshot();
				await testInfo.attach('on-test-end', { body: screenshot, contentType: 'image/png' });
			} catch {
				// Page may not be available if app failed to start
			}
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

		// For e2e-workbench, pull logs from Docker container
		const isWorkbenchProject = testInfo.project.name === 'e2e-workbench';
		if (isWorkbenchProject) {
			await attachDockerLogsToReport(logsPath, testInfo);
		} else {
			await attachLocalLogsToReport(logsPath, testInfo);
		}
	};
}

/**
 * Attach logs from the local filesystem (non-Docker projects)
 */
async function attachLocalLogsToReport(logsPath: string, testInfo: playwright.TestInfo): Promise<void> {
	const zipPath = path.join(logsPath, 'logs.zip');
	const output = fs.createWriteStream(zipPath);
	const archive = archiver('zip', { zlib: { level: 9 } });

	archive.on('error', (err: Error) => {
		throw err;
	});

	archive.pipe(output);

	// add all log files to the archive
	archive.glob('**/*', { cwd: logsPath, ignore: ['logs.zip'] });

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
}

/**
 * Pull logs from Docker container, attach to report, and clean up container logs
 */
async function attachDockerLogsToReport(logsPath: string, testInfo: playwright.TestInfo): Promise<void> {
	const { exec } = require('child_process');
	const { promisify } = require('util');
	const execP = promisify(exec);

	const containerName = 'test';
	const containerLogsPath = '/home/user1/.local/state/positron/logs';
	const tempLogsDir = path.join(logsPath, 'docker-logs');
	const zipPath = path.join(logsPath, 'logs.zip');

	try {
		// Create temporary directory to store copied logs
		await fs.promises.mkdir(tempLogsDir, { recursive: true });

		// Copy logs from container to local temp directory
		// Using tar to handle file permissions and nested directories properly
		let hasDockerLogs = false;
		try {
			await execP(`docker exec ${containerName} tar -C ${containerLogsPath} -cf - . | tar -C ${tempLogsDir} -xf -`, {
				maxBuffer: 1024 * 1024 * 50, // 50 MB buffer for logs
			});
			hasDockerLogs = true;
		} catch (err: any) {
			// If logs don't exist in container or copy fails, log and continue
			console.warn(`Failed to copy logs from Docker container: ${err.message}`);
		}

		// Check if we got any files from Docker
		const dockerFiles = hasDockerLogs ? await fs.promises.readdir(tempLogsDir) : [];
		if (dockerFiles.length === 0) {
			console.log('No logs found in Docker container');
		}

		// Check if local test logs exist (these are always local, not in Docker)
		let hasLocalLogs = false;
		try {
			const localLogStats = await fs.promises.stat(logsPath);
			if (localLogStats.isDirectory()) {
				const localFiles = await fs.promises.readdir(logsPath);
				hasLocalLogs = localFiles.some(f => f !== 'docker-logs' && f !== 'logs.zip');
			}
		} catch (err: any) {
			console.warn(`Failed to check local logs: ${err.message}`);
		}

		// If we have neither Docker logs nor local logs, nothing to attach
		if (dockerFiles.length === 0 && !hasLocalLogs) {
			console.log('No logs to attach');
			return;
		}

		// Create zip archive from both Docker logs and local test logs
		const output = fs.createWriteStream(zipPath);
		const archive = archiver('zip', { zlib: { level: 9 } });

		archive.on('error', (err: Error) => {
			throw err;
		});

		archive.pipe(output);

		// Add Docker logs to the archive (from temp directory)
		if (dockerFiles.length > 0) {
			archive.glob('**/*', { cwd: tempLogsDir, ignore: ['logs.zip'] });
		}

		// Add local test logs to the archive (from logsPath)
		if (hasLocalLogs) {
			archive.glob('**/*', { cwd: logsPath, ignore: ['logs.zip', 'docker-logs', 'docker-logs/**'] });
		}

		// Wait for the archive to finalize and the output stream to close
		await new Promise((resolve, reject) => {
			output.on('close', () => resolve(undefined));
			output.on('error', reject);
			archive.finalize();
		});

		// Attach the zipped file to the report
		await testInfo.attach(`logs-${path.basename(testInfo.file)}.zip`, {
			path: zipPath,
			contentType: 'application/zip',
		});

		// NOTE: We do NOT clean up container logs here because:
		// - The app runs at worker scope (one instance per test file)
		// - If we delete logs after test 1, the app won't recreate them for test 2+
		// - Logs are cleaned up once at worker teardown in _test.setup.ts
	} catch (err: any) {
		console.error(`Failed to process Docker logs: ${err.message}`);
	} finally {
		// Clean up local temporary files
		try {
			await fs.promises.rm(tempLogsDir, { recursive: true, force: true });
		} catch (err) {
			console.error(`Failed to remove temporary logs directory: ${err}`);
		}

		try {
			await fs.promises.unlink(zipPath);
		} catch (err) {
			// Ignore - zip file may not exist
		}
	}
}

/**
 * Whether we manage Playwright tracing ourselves via per-test chunks (Positron
 * desktop runs and all command-line runs), as opposed to letting Playwright's
 * built-in tracing handle it (browser-based runs in UI mode or the VS Code
 * extension). The continuous recording is started once per worker when the app
 * context is created; we slice it into per-test chunks (see `TracingFixture`).
 */
export function shouldUseCustomTracing(project: playwright.FullProject): boolean {
	const isCommandLineRun = !!process.env.npm_execpath && !(process.env.PW_UI_MODE === 'true');
	// Use Playwright's built-in tracing only for browser-based runs (extension, UI mode).
	return !(project.use.browserName && !isCommandLineRun);
}

export function TracingFixture() {
	return async (options: TracingOptions, use: (arg0: Application) => Promise<void>) => {
		const { app, testInfo } = options;

		if (!shouldUseCustomTracing(testInfo.project)) {
			// Playwright's built-in tracing manages the trace for this run.
			await use(app);
			return;
		}

		// Ensure a chunk is recording for this test. This fixture is an auto fixture,
		// so it sets up before the test's request fixtures (`python`, `r`, ...) and
		// `beforeEach` hooks -- their activity is captured. For the first test in the
		// worker this is a no-op: the driver already opened the "startup" chunk at
		// context creation, so that chunk (covering app startup and `beforeAll`) is
		// reused and exported as the first test's trace. We deliberately open here at
		// setup rather than re-opening in teardown: a test that leaves a blocking
		// native dialog (e.g. the PDF print preview) would hang startTracing() in
		// teardown. The try/finally still ensures we export even when `use()` rejects.
		await app.startTracing(testInfo.titlePath.join(' › '));
		try {
			await use(app);
		} finally {
			// Export the chunk for this test.
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
