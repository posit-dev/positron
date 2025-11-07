/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';
import { LOGGER } from './extension';
import { exec } from 'child_process';
import { RBinary } from './provider.js';
import { ReasonDiscovered } from './r-installation.js';

const execPromise = util.promisify(exec);

/**
 * Check if Conda is installed by running `conda --version`
 */
export async function isCondaAvailable(): Promise<boolean> {
	try {
		await execPromise('conda --version');
		return true;
	} catch {
		return false;
	}
}

/**
 * Retrieve Conda environment paths using `conda env list --json`
 */
export async function getCondaEnvironments(): Promise<string[]> {
	try {
		const { stdout } = await execPromise('conda env list --json');
		const envs = JSON.parse(stdout).envs as string[];
		return envs;
	} catch (error) {
		LOGGER.error('Failed to retrieve Conda environments:', error);
		return [];
	}
}

/**
 * Discover R binaries inside Conda environments
 */

/**
 * Get expected R binary path inside a Conda environment
 */
export function getCondaRPaths(envPath: string): string[] {
	const paths: string[] = [];
	if (process.platform !== 'win32') {
		paths.push(path.join(envPath, 'bin', 'R'));
	} else {
		paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'x64', 'R.exe')); // Prioritise x64 binaries
		paths.push(path.join(envPath, 'Lib', 'R', 'bin', 'R.exe'));
	}
	return paths;
}

/**
 * Discovers R binaries that are installed in conda environments.
 * @returns conda R binaries.
 */
export async function discoverCondaBinaries(): Promise<RBinary[]> {

	const rBinaries: RBinary[] = [];

	const enabled = vscode.workspace.getConfiguration('positron.r').get<boolean>('interpreters.condaDiscovery');
	if (enabled) {
		if (!(await isCondaAvailable())) {
			LOGGER.info('Conda is not installed or not in PATH.');
			return [];
		}

		const condaEnvs = await getCondaEnvironments();

		for (const envPath of condaEnvs) {
			const rPaths = getCondaRPaths(envPath);  // list of R binaries in this environment

			if (rPaths.length === 0) {
				continue;
			}

			for (const rPath of rPaths) {
				if (fs.existsSync(rPath)) { // return the first existing R
					LOGGER.info(`Detected R in Conda environment: ${rPath}`);
					rBinaries.push({
						path: rPath,
						reasons: [ReasonDiscovered.CONDA],
						condaEnvironmentPath: envPath
					});
					break;
				}
			}

		}
	}

	return rBinaries;
}
