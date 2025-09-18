/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as fs from 'fs';
import { constants, access, rm, mkdir, rename } from 'fs/promises';
import { copyFixtureFile, MultiLogger } from '../../infra';
import { SPEC_NAME, ROOT_PATH } from './constants';

let fixtureScreenshot: Buffer | undefined;

export function setFixtureScreenshot(screenshot: Buffer) {
	fixtureScreenshot = screenshot;
}

export function getFixtureScreenshot(): Buffer | undefined {
	return fixtureScreenshot;
}

/**
 * Copy user settings to the specified user data directory.
 * If running in a Docker environment, merges standard settings with Docker-specific overrides.
 *
 * @param userDir The user data directory to copy settings into
 */
export async function copyUserSettings(userDir: string): Promise<void> {
	const settingsFileName = 'settings.json';

	if (fs.existsSync('/.dockerenv')) {
		const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
		const settingsFile = path.join(fixturesDir, 'settings.json');
		const dockerSettingsFile = path.join(fixturesDir, 'settingsDocker.json');

		const mergedSettings = {
			...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
			...JSON.parse(fs.readFileSync(dockerSettingsFile, 'utf8')),
		};

		// Write merged settings directly to user directory
		const userSettingsFile = path.join(userDir, 'settings.json');
		fs.writeFileSync(userSettingsFile, JSON.stringify(mergedSettings, null, 2));
	} else {
		// For non-Docker environments, use the normal copyFixtureFile approach
		await copyFixtureFile(settingsFileName, userDir);
	}
}

export async function moveAndOverwrite(logger: MultiLogger, logsPath: string, workerInfo: any) {
	const specLogsPath = path.join(path.dirname(logsPath), SPEC_NAME || `worker-${workerInfo.workerIndex}`);

	try {
		await access(logsPath, constants.F_OK);
	} catch {
		console.error(`moveAndOverwrite: source path does not exist: ${logsPath}`);
		return;
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
}
