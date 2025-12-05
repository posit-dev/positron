/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as fs from 'fs';
import { constants, access, rm, mkdir, rename } from 'fs/promises';
import { copyFixtureFile, MultiLogger, Application } from '../../infra';
import { SPEC_NAME, ROOT_PATH } from './constants';

let fixtureScreenshot: Buffer | undefined;

export function setFixtureScreenshot(screenshot: Buffer) {
	fixtureScreenshot = screenshot;
}

export function getFixtureScreenshot(): Buffer | undefined {
	return fixtureScreenshot;
}

/**
 * Capture a screenshot when an error occurs in a fixture
 */
export async function captureScreenshotOnError(app: Application, logsPath: string, error: any): Promise<void> {
	console.error('Error occurred in fixture:', error);

	const screenshotPath = path.join(logsPath, 'fixture-failure.png');
	try {
		const page = app.code?.driver?.page;
		if (page) {
			const screenshot = await page.screenshot({ path: screenshotPath });
			setFixtureScreenshot(screenshot);
		}
	} catch (screenshotError) {
		console.warn('Failed to capture screenshot:', screenshotError);
	}
}

/**
 * Copy user settings to the specified user data directory.
 * If running in a Docker environment, merges standard settings with Docker-specific overrides.
 *
 * @param userDir The user data directory to copy settings into
 */
export async function copyUserSettings(userDir: string): Promise<string> {
	const settingsFileName = 'settings.json';
	const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
	const settingsFile = path.join(fixturesDir, settingsFileName);

	// Start from the current settings.json in fixtures
	let mergedSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

	// 1. Merge Docker-specific overrides when running in Docker
	if (fs.existsSync('/.dockerenv')) {
		const dockerSettingsFile = path.join(fixturesDir, 'settingsDocker.json');
		if (fs.existsSync(dockerSettingsFile)) {
			const dockerSettings = JSON.parse(fs.readFileSync(dockerSettingsFile, 'utf8'));
			mergedSettings = {
				...mergedSettings,
				...dockerSettings,
			};
		}
	}

	// 2. Merge skip-pyrefly settings if ALLOW_PYREFLY is not explicitly 'true'
	if (process.env.ALLOW_PYREFLY !== 'true') {
		const skipPyreflyFile = path.join(fixturesDir, 'settingsSkipPyrefly.json');
		if (fs.existsSync(skipPyreflyFile)) {
			const skipPyreflySettings = JSON.parse(fs.readFileSync(skipPyreflyFile, 'utf8'));
			mergedSettings = {
				...mergedSettings,
				...skipPyreflySettings,
			};
		}
	}

	// Overwrite fixtures/settings.json with the merged result
	fs.writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));

	// Let existing helper copy settings.json into the user dir
	await copyFixtureFile(settingsFileName, userDir);
	return userDir;
}

/**
 * Rename a temporary logs directory to a more descriptive name based on the test spec.
 * If a directory with the target name already exists, it will be overwritten.
 * If SPEC_NAME is not defined, uses a generic worker-based name.
 *
 * @param logger The logger instance to use for logging.
 * @param logsPath The path to the logs directory.
 * @param workerInfo Information about the worker process.
 * @returns A promise that resolves when the operation is complete.
 */
export async function renameTempLogsDir(logger: MultiLogger, logsPath: string, workerInfo: any): Promise<string> {
	const specLogsPath = path.join(path.dirname(logsPath), SPEC_NAME || `worker-${workerInfo.workerIndex}`);

	try {
		await access(logsPath, constants.F_OK);
	} catch {
		console.error(`moveAndOverwrite: source path does not exist: ${logsPath}`);
		return 'unable to rename temp logs dir';
	}

	// check if the destination exists and delete it if so
	try {
		await access(specLogsPath, constants.F_OK);
		await rm(specLogsPath, { recursive: true, force: true });
	} catch (err) { }

	// ensure parent directory of destination path exists
	const destinationDir = path.dirname(specLogsPath);
	await mkdir(destinationDir, { recursive: true });

	// rename source to destination
	try {
		await rename(logsPath, specLogsPath);
		logger.setPath(specLogsPath);
		logger.log('Logger path updated to:', specLogsPath);
	} catch (err) {
		logger.log(`moveAndOverwrite: failed to move ${logsPath} to ${specLogsPath}:`, err);
	}
	return specLogsPath
}
