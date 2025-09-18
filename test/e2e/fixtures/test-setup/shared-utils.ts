/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import { constants, access, rm, mkdir, rename } from 'fs/promises';
import { MultiLogger } from '../../infra';
import { SPEC_NAME } from './constants';

let fixtureScreenshot: Buffer | undefined;

export function setFixtureScreenshot(screenshot: Buffer) {
	fixtureScreenshot = screenshot;
}

export function getFixtureScreenshot(): Buffer | undefined {
	return fixtureScreenshot;
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
