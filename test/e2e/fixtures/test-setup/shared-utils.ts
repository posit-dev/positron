/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as fs from 'fs';
import { mkdir } from 'fs/promises';
import { Application } from '../../infra';
import { ROOT_PATH } from './constants';

/**
 * Derive a log directory name from the suiteId (test file path).
 * Extracts a relative path from the tests directory as the directory name.
 * Falls back to worker index if suiteId is not available.
 *
 * @param suiteId The suite ID (typically __filename from the test file)
 * @param workerIndex The worker index as fallback
 * @returns A sanitized directory name
 */
export function deriveLogDirName(suiteId: string, workerIndex: number): string {
	if (!suiteId) {
		return `worker-${workerIndex}`;
	}

	// Extract relative path from "tests/" directory: "/path/to/tests/console/console-input.test.ts" -> "console_console-input"
	const testsMatch = suiteId.match(/\/tests\/(.+)\.test\.ts$/);
	if (testsMatch) {
		const relativePath = testsMatch[1];
		// Replace path separators with underscores and sanitize
		const sanitized = relativePath.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_');
		return sanitized || `worker-${workerIndex}`;
	}

	// Fallback: just use the filename without extension
	const fileName = path.basename(suiteId, '.test.ts');
	const sanitized = fileName.replace(/[^a-zA-Z0-9_-]/g, '_');

	return sanitized || `worker-${workerIndex}`;
}

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

	// Write merged settings directly to user data directory (avoids race condition with shared fixture file)
	await mkdir(userDir, { recursive: true });
	const userSettingsFile = path.join(userDir, settingsFileName);
	fs.writeFileSync(userSettingsFile, JSON.stringify(mergedSettings, null, 2));

	return userDir;
}
